

import esri = __esri;

// esri
import request = require("esri/request");
import Map = require("esri/Map");

// esri.geometry
import Extent = require("esri/geometry/Extent");

// esri.layers
import Layer = require("esri/layers/Layer");
import BaseTileLayer = require("esri/layers/BaseTileLayer");

// esri.views
import SceneView = require("esri/views/SceneView");

// esri.views.3d
import externalRenderers = require("esri/views/3d/externalRenderers");

// ./support

import * as log from "./support/log";

let view: SceneView;

interface ProgramDefinition {
  program: WebGLProgram;
  uniforms: { [key: string]: WebGLUniformLocation };
}

interface ParticleSystemProperties {
  gl: WebGLRenderingContext;

  velocityField: VelocityFieldTexture;
  reprojection: SimulatedFloatTextures;

  view: esri.SceneView;
  extent: Extent;
}

class ParticleSystem {
  private programs: {
    update: ProgramDefinition;
    render: ProgramDefinition;
  };

  // Context
  gl: WebGLRenderingContext;
  view: esri.SceneView;
  extent: Extent;

  // Settings
  private readonly numParticlesInTrail = 32;
  private readonly numParticleStreams = 1024 * 1024 / this.numParticlesInTrail;
  private readonly useLines = true;
  private readonly timestep = 1 / 60;

  // Precomputed
  private readonly totalNumParticles = this.numParticleStreams * this.numParticlesInTrail;
  private readonly particlePotSize = 1 << Math.ceil(Math.log(Math.sqrt(this.totalNumParticles)) / Math.LN2);

  // Particle simulation
  private time = 0;

  private simulationFBO: WebGLFramebuffer;
  private quadGeometryVBO: WebGLBuffer;
  private particleOriginsTexture: WebGLTexture;

  private particleStateTextures: WebGLTexture[];
  private velocityFieldTexture: VelocityFieldTexture;

  // Rendering
  private particleGeometryVBO: WebGLBuffer;
  private reprojectionTexture: SimulatedFloatTextures;

  constructor(properties: ParticleSystemProperties) {
    this.gl = properties.gl;
    this.view = properties.view;
    this.extent = properties.extent;

    this.velocityFieldTexture = properties.velocityField;
    this.reprojectionTexture = properties.reprojection;

    this.initializeResources();
  }

  /**
   * Initialize all the GPU resources for running the particle
   * simulation and rendering the particles.
   */
  private initializeResources() {
    this.initializeSimulationFBO();
    // this.initializeRenderFBO();

    this.initializeQuadGeometryVBO();
    this.initializeParticleGeometryVBO();
    this.initializePrograms();

    this.initializeParticles();
  }

  /**
   * Creates the FBO used to run the simulation.
   */
  private initializeSimulationFBO() {
    const gl = this.gl;
    this.simulationFBO = gl.createFramebuffer();
  }

  private createRenderTexture() {
    const gl = this.gl;
    const renderTexture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, renderTexture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.view.width, this.view.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    return renderTexture;
  }

  /**
   * Initialize the VBO geometry used to run the particle simulation.
   * This is simply a quad (using a triangle strip) which covers the
   * texture that contains the particle state.
   */
  private initializeQuadGeometryVBO() {
    const gl = this.gl;

    this.quadGeometryVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadGeometryVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  }

  /**
   * Initialize attributes in a VBO buffer for a single particle.
   */
  private initializeParticleAttributes(particleData: Float32Array, i: number, offset: number) {
    const x = i % this.particlePotSize;
    const y = Math.floor(i / this.particlePotSize);

    particleData[offset + 0] = (x + 0.5) / this.particlePotSize;
    particleData[offset + 1] = (y + 0.5) / this.particlePotSize;
    particleData[offset + 2] = (i % this.numParticleStreams) / this.numParticleStreams * 2 * Math.PI;
    particleData[offset + 3] = (Math.floor(i / this.numParticleStreams) + 1) / this.numParticlesInTrail;
  }

  /**
   * Create VBO containing geometry attributes for rendering particles. Particles
   * may be rendered either as points or as connected lines, depending on useLines.
   */
  private initializeParticleGeometryVBO() {
    if (this.useLines) {
      this.initializeParticleVBOLines();
    }
    else {
      this.initializeParticleVBOPoints();
    }
  }

  /**
   * Create VBO containing geometry attributes for rendering particles
   * as lines.
   */
  private initializeParticleVBOLines() {
    const gl = this.gl;

    const vertexPairs = (this.numParticlesInTrail - 1) * 2;
    const particleData = new Float32Array(vertexPairs * this.numParticleStreams * 4);
    let ptr = 0;

    for (let i = 0; i < this.numParticleStreams; i++) {
      for (let j = 0; j < this.numParticlesInTrail - 1; j++) {
        const idx = j * this.numParticleStreams + i;
        const nextIdx = idx + this.numParticleStreams;

        this.initializeParticleAttributes(particleData, idx, ptr);
        ptr += 4;

        this.initializeParticleAttributes(particleData, nextIdx, ptr);
        ptr += 4;
      }
    }

    this.particleGeometryVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleGeometryVBO);
    gl.bufferData(gl.ARRAY_BUFFER, particleData, gl.STATIC_DRAW);
  }

  /**
   * Create VBO containing geometry attributes for rendering particles
   * as points.
   */
  private initializeParticleVBOPoints() {
    const gl = this.gl;

    const particleData = new Float32Array(this.totalNumParticles * 4);
    let ptr = 0;

    for (let i = 0; i < this.totalNumParticles; i++) {
      this.initializeParticleAttributes(particleData, i, ptr);
      ptr += 4;
    }

    this.particleGeometryVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleGeometryVBO);
    gl.bufferData(gl.ARRAY_BUFFER, particleData, gl.STATIC_DRAW);
  }

  private initializePrograms() {
    this.programs = {
      update: {
        program: this.createProgram("update",
          // Vertex shader
          `
            precision highp float;

            attribute vec3 pos;
            varying vec3 particlePosition;

            void main() {
              particlePosition = pos;
              gl_Position = vec4((pos.xy * 2.0) - 1.0, 0, 1);
            }
          `,

          // Fragment shader
          `
            precision highp float;
            precision highp sampler2D;

            varying vec3 particlePosition;

            uniform sampler2D particles;

            uniform sampler2D velocityField;
            uniform sampler2D particleOriginsTexture;

            uniform float timestep;
            uniform float time;

            uniform vec2 velocityOffset;
            uniform vec2 velocityScale;

            const float trailSize = float(${this.numParticlesInTrail});

            float random(vec2 co) {
              return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }

            float rgba2float(vec4 rgba) {
		          return dot(rgba, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
	          }

            void main() {
              vec4 particle = texture2D(particles, particlePosition.xy);

              // Check if particle is even alive
              if (particle.z < 0.0) {
                if (-particle.z <= time) {
                  // Should become alive and die after some time
                  particle.z = time;
                }
              }
              // Check if particle is now dead
              else {
                float lifeSpan = 10.0 + random(vec2(particle.z, -particle.z)) * 10.0;
                float elapsed = time - particle.z;
                float remaining = lifeSpan - elapsed;

                float delay = timestep * trailSize * 5.0;

                if (elapsed >= lifeSpan) {
                  // Reposition it on the grid, based on some randomization
                  particle.xy = texture2D(particleOriginsTexture, particlePosition.xy).xy;

                  // Create a random time-to-life
                  particle.z = -(time + 1.0 + random(particle.xy + vec2(time, time)) * 2.0);
                }
                // Otherwise just update the particle position according to the velocity field
                else if (elapsed > particle.w * delay && remaining > (1.0 - particle.w) * delay) {
                  vec2 velocity = texture2D(velocityField, particle.xy).xy * velocityScale + velocityOffset;

                  const float velocityTimeScale = 0.0005;
                  vec2 vupdate = vec2(velocity.x, -velocity.y) * timestep * velocityTimeScale;

                  particle.xy += vupdate;
                }
              }

              gl_FragColor = particle;
            }
          `
        ),

        uniforms: null
      },

      render: {
        program: this.createProgram("render",
          // Vertex shader
          `
            precision highp float;
            precision highp sampler2D;

            uniform sampler2D particles;

            uniform sampler2D reprojectionX;
            uniform sampler2D reprojectionY;
            uniform sampler2D reprojectionZ;

            uniform float reprojectionOffset;
            uniform float reprojectionScale;

            uniform mat4 viewMatrix;
            uniform mat4 projectionMatrix;
            uniform float time;


            attribute vec2 position;
            attribute float age;

            varying float fAge;
            varying vec4 particle;

            float rgba2float(vec4 rgba) {
		          return dot(rgba, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
	          }

            float random(vec2 co) {
              return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {
              particle = texture2D(particles, position);

              float lifeSpan = 10.0 + random(vec2(particle.z, -particle.z)) * 5.0;
              float elapsed = time - particle.z;
              float remaining = lifeSpan - elapsed;

              fAge = smoothstep(0.0, 2.0, remaining) * (age + 0.5) * 0.75;

              gl_PointSize = 1.0 + fAge;

              if (particle.z < 0.0) {
                // Not alive, clip?
                gl_Position = vec4(-2, -2, -2, 1);
              }
              else {
                vec4 posX = texture2D(reprojectionX, particle.xy);
                vec4 posY = texture2D(reprojectionY, particle.xy);
                vec4 posZ = texture2D(reprojectionZ, particle.xy);

                vec3 pos = vec3(rgba2float(posX), rgba2float(posY), rgba2float(posZ)) * reprojectionScale + reprojectionOffset;

                vec4 ndcPos = projectionMatrix * viewMatrix * vec4(pos, 1);

                // Add a constant z-bias to push the points towards the viewer, so
                // we don't z-fight with the terrain
                ndcPos.z -= 0.0001 * ndcPos.w;

                gl_Position = ndcPos;
              }
            }
          `,

          // Fragment shader
          `
            precision highp float;
            precision highp sampler2D;

            uniform sampler2D velocityField;
            uniform float time;
            uniform vec2 velocityScale;
            uniform vec2 velocityOffset;

            varying vec4 particle;
            varying float fAge;

            void main() {
              vec3 velocity = texture2D(velocityField, particle.xy).xyz;
              gl_FragColor = vec4(velocity.xyz, fAge);
            }
          `
        ),

        uniforms: null
      }
    };

    this.programs.update.uniforms = this.extractUniforms(this.programs.update.program, [
      "particles", "velocityField", "velocityScale", "velocityOffset", "time", "timestep", "particleOriginsTexture"
    ]);

    this.programs.render.uniforms = this.extractUniforms(this.programs.render.program, [
      "particles", "reprojectionX", "reprojectionY", "reprojectionZ", "reprojectionScale", "reprojectionOffset", "viewMatrix", "projectionMatrix", "velocityField", "velocityScale", "velocityOffset", "time"
    ]);
  }

  private extractUniforms(program: WebGLProgram, names: string[]): { [key: string]: WebGLUniformLocation } {
    const ret: { [key: string]: WebGLUniformLocation } = {};
    const gl = this.gl;

    for (const name of names) {
      ret[name] = gl.getUniformLocation(program, name);
    }

    return ret;
  }

  private randomPositionOnSphere(): number[] {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());

    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);

    const coord = [0, 0, 0];
    externalRenderers.fromRenderCoordinates(this.view, [x * 6378137, y * 6378137, z * 6378137], 0, coord, 0, this.view.spatialReference, 1);

    return [
      (coord[0] - this.extent.xmin) / this.extent.width,
      (coord[1] - this.extent.ymin) / this.extent.height
    ];
  }

  private initializeParticles() {
    let ptr = 0;
    const particleData = new Float32Array(this.particlePotSize * this.particlePotSize * 4);

    // Generate initial particle positions
    for (var i = 0; i < this.numParticleStreams; i++) {
      const [ x, y ] = this.randomPositionOnSphere();

      const timeToBirth = Math.random() * 20;

      for (var j = 0; j < this.numParticlesInTrail; j++) {
        var offset = j * this.numParticleStreams * 4;

        particleData[ptr + offset + 0] = x;
        particleData[ptr + offset + 1] = y;

        // TTB (time to birth), in seconds
        particleData[ptr + offset + 2] = -timeToBirth;

        // Normalized trail delay
        particleData[ptr + offset + 3] = 1 - (j + 1) / this.numParticlesInTrail;
      }

      ptr += 4;
    }

    this.particleOriginsTexture = this.createFloatTexture(particleData, this.particlePotSize);

    this.particleStateTextures = [
      this.createFloatTexture(particleData, this.particlePotSize),
      this.createFloatTexture(null, this.particlePotSize)
    ];
  }

  private programLog(name: string, info: string) {
    if (info) {
      console.error("Failed to compile or link", name, info);
    }
  }

  private renderQuadGeometryVBO(context: esri.RenderContext) {
    const gl = context.gl;

    // Setup draw geometrysimulationGeometryVBO
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadGeometryVBO);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    // Finally, draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private createProgram(name: string, vertex: string, fragment: string) {
    const gl = this.gl;
    const program = gl.createProgram();
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.shaderSource(vertexShader, vertex);
    gl.compileShader(vertexShader);
    this.programLog(`${name} - vertex`, gl.getShaderInfoLog(vertexShader));

    gl.shaderSource(fragmentShader, fragment);
    gl.compileShader(fragmentShader);
    this.programLog(`${name} - fragment`, gl.getShaderInfoLog(fragmentShader));

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    this.programLog(`${name} - link program`, gl.getProgramInfoLog(program));

    return program;
  }

  private createFloatTexture(data: Float32Array | null, size: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.FLOAT, data);

    return texture;
  }

  update(context: esri.RenderContext): void {
    this.time += this.timestep;

    const gl = this.gl;

    // Bind input textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.particleStateTextures[0]);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityFieldTexture.texture);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.particleOriginsTexture);

    // Setup FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.simulationFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleStateTextures[1], 0);
    gl.viewport(0, 0, this.particlePotSize, this.particlePotSize);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    // Setup program and uniforms
    const program = this.programs.update;

    gl.useProgram(program.program);

    gl.uniform1i(program.uniforms["particles"], 0);

    gl.uniform1i(program.uniforms["velocityField"], 1);
    gl.uniform1i(program.uniforms["particleOriginsTexture"], 2);

    gl.uniform2f(program.uniforms["velocityScale"], this.velocityFieldTexture.scaleU, this.velocityFieldTexture.scaleV);
    gl.uniform2f(program.uniforms["velocityOffset"], this.velocityFieldTexture.offsetU, this.velocityFieldTexture.offsetV);

    gl.uniform1f(program.uniforms["time"], this.time);
    gl.uniform1f(program.uniforms["timestep"], this.timestep);

    this.renderQuadGeometryVBO(context);

    // When update is done, swap the I/O textures
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    [this.particleStateTextures[0], this.particleStateTextures[1]] = [this.particleStateTextures[1], this.particleStateTextures[0]];

    gl.viewport(0, 0, context.camera.fullWidth, context.camera.fullHeight);
  }

  private renderParticles(context: esri.RenderContext): void {
    const gl = context.gl;

    // Bind input texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.particleStateTextures[0]);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.reprojectionTexture.textures[0]);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.reprojectionTexture.textures[1]);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.reprojectionTexture.textures[2]);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.velocityFieldTexture.texture);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);

    // Setup program and uniforms
    const program = this.programs.render;

    gl.useProgram(program.program);

    gl.uniform1i(program.uniforms["particles"], 0);

    gl.uniform1i(program.uniforms["reprojectionX"], 1);
    gl.uniform1i(program.uniforms["reprojectionY"], 2);
    gl.uniform1i(program.uniforms["reprojectionZ"], 3);
    gl.uniform1i(program.uniforms["velocityField"], 4);

    gl.uniform2f(program.uniforms["velocityScale"], this.velocityFieldTexture.scaleU, this.velocityFieldTexture.scaleV);
    gl.uniform2f(program.uniforms["velocityOffset"], this.velocityFieldTexture.offsetU, this.velocityFieldTexture.offsetV);

    gl.uniform1f(program.uniforms["reprojectionScale"], this.reprojectionTexture.scale);
    gl.uniform1f(program.uniforms["reprojectionOffset"], this.reprojectionTexture.offset);

    gl.uniformMatrix4fv(program.uniforms["viewMatrix"], false, context.camera.viewMatrix);
    gl.uniformMatrix4fv(program.uniforms["projectionMatrix"], false, context.camera.projectionMatrix);

    gl.uniform1f(program.uniforms["time"], this.time);
    gl.uniform1f(program.uniforms["timestep"], this.timestep);

    // Setup draw geometry
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleGeometryVBO);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);

    // Finally, draw
    if (this.useLines) {
      gl.drawArrays(gl.LINES, 0, (this.numParticlesInTrail - 1) * 2 * this.numParticleStreams);
    }
    else {
      gl.drawArrays(gl.POINTS, 0, this.totalNumParticles);
    }

    gl.disableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
  }

  render(context: esri.RenderContext): void {
    context.bindRenderTarget();
    this.renderParticles(context);

    context.resetWebGLState();
  }
}

class ExternalRenderer {
  private particleSystem: ParticleSystem;
  private readyToRender = false;

  private velocityField: VelocityFieldTexture;
  private reprojection: SimulatedFloatTextures;

  paused = false;
  singleStep = false;

  constructor(private view: esri.SceneView) {
    view.on("hold", () => {
      this.paused = !this.paused;

      console.log("paused", this.paused);

      if (!this.paused) {
        externalRenderers.requestRender(view);
      }
    });

    view.on("pointer-up", ["Primary"], () => {
      if (this.paused) {
        this.paused = false;
        this.singleStep = true;
        externalRenderers.requestRender(view);
      }
    });
  }

  setup(context: esri.RenderContext) {
    const gl = context.gl;

    gl.getExtension("OES_texture_float");

    this.prepareResources(context)
        .then(() => {
          this.readyToRender = true;
          externalRenderers.requestRender(this.view);

          console.log("going to render");
        });
  }

  renderTransparent(context: esri.RenderContext) {
    if (!this.readyToRender) {
      return;
    }

    if (this.particleSystem) {
      if (!this.paused) {
        this.particleSystem.update(context);
      }

      this.particleSystem.render(context);

      if (this.singleStep) {
        console.log("stepped");
        this.paused = true;
        this.singleStep = false;
      }
    }

    context.resetWebGLState();

    if (!this.paused) {
      externalRenderers.requestRender(this.view);
    }
  }

  private prepareResources(context: esri.RenderContext) {
    let rasterInfo: FetchedRaster;

    return this.fetchRaster()
        .then(fetchedRaster => {
          rasterInfo = fetchedRaster;

          this.createTextures(context, fetchedRaster);
        })
        .then(() => {
          this.createParticleSystem(context, rasterInfo.extent);
        });
  }

  private createParticleSystem(context: esri.RenderContext, extent: Extent) {
    this.particleSystem = new ParticleSystem({
      gl: context.gl,
      view: this.view,
      extent: extent,
      velocityField: this.velocityField,
      reprojection: this.reprojection
    });
  }

  private encodeFloatRGBA(value: number, rgba: Uint8Array, offset: number) {
    const r = value % 1;
    const g = (value * 255) % 1;
    const b = (value * 65025) % 1;
    const a = (value * 16581375) % 1;

    rgba[offset] = r * 255 - g;
    rgba[offset + 1] = g * 255 - b;
    rgba[offset + 2] = b * 255 - a;
    rgba[offset + 3] = a * 255;
  }

  private decodeFloatRGBA(rgba: Uint8Array, offset: number): number {
    const r = rgba[offset + 0];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    const a = rgba[offset + 3];

    return r / 255 + g / 65025 + b / 16581375 + a / 4228250625;
  }

  private createReprojectionData(extent: Extent, resolution: number = 512): { data: Uint8Array[]; bounds: number[]; resolution: number; } {
    const size = resolution * resolution * 4;

    const normalize = (value: number, bounds: number[]): number => {
      return (value - bounds[0]) / (bounds[1] - bounds[0]);
    };

    const reprojectionDatas = [
      new Uint8Array(size),
      new Uint8Array(size),
      new Uint8Array(size)
    ];

    const reprojectionBounds = [ -6378137, 6378137 ];
    const reprojectedPoint = [0, 0, 0];

    let byteOffset = 0;

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const pt = [
          extent.xmin + (x + 0.5) / resolution * extent.width,
          extent.ymax - (y + 0.5) / resolution * extent.height,
          0
        ];

        externalRenderers.toRenderCoordinates(this.view, pt, 0, extent.spatialReference, reprojectedPoint, 0, 1);

        this.encodeFloatRGBA(normalize(reprojectedPoint[0], reprojectionBounds), reprojectionDatas[0], byteOffset);
        this.encodeFloatRGBA(normalize(reprojectedPoint[1], reprojectionBounds), reprojectionDatas[1], byteOffset);
        this.encodeFloatRGBA(normalize(reprojectedPoint[2], reprojectionBounds), reprojectionDatas[2], byteOffset);

        byteOffset += 4;
      }
    }

    return {
      data: reprojectionDatas,
      bounds: reprojectionBounds,
      resolution
    };
  }

  private createTextures(context: esri.RenderContext, fetchedRaster: FetchedRaster) {
    // Create:
    //   - velocity field texture, X/Y, velocity in m/s
    //   - 3D re-projection texture
    const rasterData = fetchedRaster.rasterData;
    const resolution = rasterData.width;
    const textureDataSize = resolution * resolution * 4 * 2;

    const reprojectionDatas = this.createReprojectionData(fetchedRaster.extent);

    const gl = context.gl;

    this.velocityField = {
      texture: this.createTexture(context.gl, resolution, rasterData, gl.LINEAR),

      offsetU: fetchedRaster.serviceInfo.minValues[0],
      scaleU: fetchedRaster.serviceInfo.maxValues[0] - fetchedRaster.serviceInfo.minValues[0],

      offsetV: fetchedRaster.serviceInfo.minValues[1],
      scaleV: fetchedRaster.serviceInfo.maxValues[1] - fetchedRaster.serviceInfo.minValues[1]
    };

    this.reprojection = {
      textures: reprojectionDatas.data.map(data => this.createTexture(context.gl, reprojectionDatas.resolution, data, gl.LINEAR)),
      offset: reprojectionDatas.bounds[0],
      scale: reprojectionDatas.bounds[1] - reprojectionDatas.bounds[0]
    };
  }

  /**
   * Create a new webgl texture. Wrapping mode is set to repeat on S and clamp on T.
   *
   * @param gl the webgl context
   * @param size the size of the texture
   * @param data the data for the texture
   * @param interpolation the type of interpolation to use
   */
  private createTexture(gl: WebGLRenderingContext, size: number, data: Uint8Array | HTMLImageElement, interpolation: number) {
    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, interpolation);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, interpolation);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

    if (data instanceof Uint8Array) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    else {
      // gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    return texture;
  }

  /**
   * Fetches the raster data used for the velocity field. This can come from
   * a ImageServer raster service, but for this demo the resulting image encoding
   * the velocity field is included (no server required). Certain values that
   * usually come from the service are hardcoded here (min and max values, and extent).
   */
  private fetchRaster(): IPromise<FetchedRaster> {
    const requestOptions: esri.requestEsriRequestOptions = {
      responseType: "image",
      allowImageDataAccess: true
    };

    const serviceInfo: ImageServiceInfo = {
      minValues: [-27.309999465942383, -22.420000076293945],
      maxValues: [27.65999984741211, 20.969999313354492]
    };

    const extent = new Extent({
      xmin: -20037508.342788905,
      xmax: 20037508.342788905,
      ymin: -20037508.342788905,
      ymax: 20037508.342788905,
      spatialReference: 102100
    });

    return request('./app/data/wind-global.png', requestOptions)
        .then((response: any) => {
          return {
            serviceInfo,
            extent,
            rasterData: response.data
          };
        });
  }
}

export function initialize() {
  view = new SceneView({
    container: "viewDiv",

    map: new Map({
      basemap: "topo-vector"
    }),

    constraints: {
      altitude: {
        min: 7374827,
        max: 51025096
      }
    },

    camera: {
      position: [-168.491, 23.648, 19175402.86],
      heading: 360.00,
      tilt: 1.37
    },

    qualityProfile: "high",

    environment: {
      atmosphere: {
        quality: "high"
      },

      lighting: {
        directShadowsEnabled: true,
        ambientOcclusionEnabled: true
      }
    },

    ui: {
      components: ["compass", "attribution"]
    } as any
  });



  view.then(() => {
    const renderer = new ExternalRenderer(view);
    externalRenderers.add(view, renderer);
  });

  window["view"] = view;
}

interface ImageServiceInfo {
  minValues: number[];
  maxValues: number[];
}

interface FetchedRaster {
  extent: Extent;
  serviceInfo: ImageServiceInfo;
  rasterData: HTMLImageElement;
}

interface SimulatedFloatTextures {
  textures: WebGLTexture[];
  scale: number;
  offset: number;
}

interface VelocityFieldTexture {
  texture: WebGLTexture;
  offsetU: number;
  scaleU: number;
  offsetV: number;
  scaleV: number;
}
