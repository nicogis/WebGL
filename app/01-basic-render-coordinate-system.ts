import esri = __esri;

// esri
import Map = require("esri/Map");

// esri.geometry
import ScreenPoint = require("esri/geometry/ScreenPoint");

// esri.views
import SceneView = require("esri/views/SceneView");

// esri.views.3d
import externalRenderers = require("esri/views/3d/externalRenderers");

// ./support
import { ProgramDefinition, createProgram } from "./support/webglUtils";
import * as log from "./support/log";


let view: SceneView;

class CustomRenderer {
  private renderAt: ScreenPoint;
  private vbo: WebGLBuffer;
  private program: ProgramDefinition;

  setup(context: esri.RenderContext) {
    const gl = context.gl;

    this.renderAt = null;

    this.initializeVertexBufferObject(context);
    this.initializeProgram(context);
  }

  render(context: esri.RenderContext) {
    if (!this.renderAt) {
      return;
    }

    const gl = context.gl;
    const point = view.toMap(this.renderAt);

    if (!point) {
      return;
    }

    const transform = externalRenderers.renderCoordinateTransformAt(view, [point.x, point.y, point.z + 1000], point.spatialReference, null);

    log.message("x:" + point.x + " y: " + point.y + " z:" + point.z);

    const { program, uniformLocations } = this.program;

    const camera = context.camera;

    // Setup program and uniforms
    gl.useProgram(program);

    gl.uniformMatrix4fv(uniformLocations.uViewMatrix, false, camera.viewMatrix);
    gl.uniformMatrix4fv(uniformLocations.uProjectionMatrix, false, camera.projectionMatrix);
    gl.uniformMatrix4fv(uniformLocations.uModelMatrix, false, transform);

    // Bind vertex buffer object and setup attribute pointers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);

    // Vertex position
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

    // Vertex color
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);

    gl.drawArrays(gl.TRIANGLES, 0, 36);

    // Make sure to reset the WebGL state when finishing the render
    context.resetWebGLState();
  }

  update(renderAt: ScreenPoint) {
    this.renderAt = renderAt;
    externalRenderers.requestRender(view);
  }

  private initializeVertexBufferObject(context: esri.RenderContext) {
    const gl = context.gl;

    this.vbo = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.createBufferData(), gl.STATIC_DRAW);
  }

  private initializeProgram(context: esri.RenderContext) {
    this.program = createProgram(context.gl, "render",
      // Vertex shader
      `
        precision highp float;

        attribute vec3 aVertexPosition;
        attribute vec3 aVertexColor;

        uniform mat4 uModelMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uProjectionMatrix;

        varying vec3 vColor;

        void main() {
          vColor = aVertexColor;

          gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aVertexPosition, 1);
        }
      `,

      // Fragment shader
      `
        precision highp float;

        varying vec3 vColor;

        void main() {
          gl_FragColor = vec4(vColor, 1);
        }
      `,

      // Uniform names
      ["uModelMatrix", "uViewMatrix", "uProjectionMatrix"]
    );
  }

  private createBufferData() {
    const size = 500000;
    const halfWidth = 10000;

    // Create data for a simple render coordinate, X, Y, Z using triangles
    return new Float32Array([
      // X flat
      0, -halfWidth, 0, // vertex
      1, 0, 0, // color

      size, halfWidth, 0, // vertex
      1, 0, 0, // color

      size, -halfWidth, 0, // vertex
      1, 0, 0, // color

      0, -halfWidth, 0, // vertex
      1, 0, 0, // color

      0, halfWidth, 0, // vertex
      1, 0, 0, // color

      size, halfWidth, 0, // vertex
      1, 0, 0, // color

      // X up
      0, 0, 0, // vertex
      0.6, 0, 0, // color

      size, 0, 0, // vertex
      0.6, 0, 0, // color

      size, 0, halfWidth, // vertex
      0.6, 0, 0, // color

      0, 0, 0, // vertex
      0.6, 0, 0, // color

      size, 0, halfWidth, // vertex
      0.6, 0, 0, // color

      0, 0, halfWidth, // vertex
      0.6, 0, 0, // color


      // Y flat
      -halfWidth, 0, 0, // vertex
      0, 1, 0, // color

      halfWidth, size, 0, // vertex
      0, 1, 0, // color

      -halfWidth, size, 0, // vertex
      0, 1, 0, // color

      -halfWidth, 0, 0, // vertex
      0, 1, 0, // color

      halfWidth, 0, 0, // vertex
      0, 1, 0, // color

      halfWidth, size, 0, // vertex
      0, 1, 0, // color

      // Y up
      0, 0, 0, // vertex
      0, 0.6, 0, // color

      0, size, 0, // vertex
      0, 0.6, 0, // color

      0, size, halfWidth, // vertex
      0, 0.6, 0, // color

      0, 0, 0, // vertex
      0, 0.6, 0, // color

      0, size, halfWidth, // vertex
      0, 0.6, 0, // color

      0, 0, halfWidth, // vertex
      0, 0.6, 0, // color


      // Z on X
      -halfWidth, 0, 0, // vertex
      0, 0, 1, // color

      halfWidth, 0, 0, // vertex
      0, 0, 1, // color

      halfWidth, 0, size, // vertex
      0, 0, 1, // color

      -halfWidth, 0, 0, // vertex
      0, 0, 1, // color

      halfWidth, 0, size, // vertex
      0, 0, 1, // color

      -halfWidth, 0, size, // vertex
      0, 0, 1, // color

      // Z on Y
      0, -halfWidth, 0, // vertex
      0, 0, 0.6, // color

      0, halfWidth, 0, // vertex
      0, 0, 0.6, // color

      0, halfWidth, size, // vertex
      0, 0, 0.6, // color

      0, -halfWidth, 0, // vertex
      0, 0, 0.6, // color

      0, halfWidth, size, // vertex
      0, 0, 0.6, // color

      0, -halfWidth, size, // vertex
      0, 0, 0.6 // color
    ]);
  }
}

export function initialize() {
  view = new SceneView({
    container: "viewDiv",

    map: new Map({
      basemap: "gray",
      ground: "world-elevation"
    }),

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

    camera: {
      position: [2.035, 31.805, 2907227.41],
      heading: 16.86,
      tilt: 31.46
    },

    ui: {
      components: ["compass", "attribution"]
    } as any
  });



  view.then(() => {
    let isFixed = false;

    // Create the custom renderer and add it to the view
    let renderer = new CustomRenderer();
    externalRenderers.add(view, renderer);

    view.on("hold", (event: any) => {
      if (!isFixed && !event.mapPoint) {
        return;
      }

      isFixed = !isFixed;
      renderer.update(new ScreenPoint({ x: event.x, y: event.y }));

      log.message(isFixed ? "Placed coordinate system" : "");
    });

    view.on("pointer-move", (event: any) => {
      if (!isFixed) {
        renderer.update(new ScreenPoint({ x: event.x, y: event.y }));
      }
    });
  });
}
