

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
import { ProgramDefinition, createProgram, createCubeGeometry } from "./support/webglUtils";
import * as log from "./support/log";
import { add as addWidget } from "./support/widgets";

import glMatrix = require("https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.3.2/gl-matrix-min.js");


let view: SceneView;

class CustomRenderer {
  private renderAt: ScreenPoint;
  private vbo: WebGLBuffer;
  private program: ProgramDefinition;

  private vertexPositionAttributeLocation: number;
  private vertexNormalAttributeLocation: number;

  private objects: {
    origin: number[];
    modelMatrix: number[];
    normalMatrix: number[];
  }[] = [];

  useLocalOrigin = false;

  setup(context: esri.RenderContext) {
    const gl = context.gl;

    this.renderAt = null;

    this.initializeVertexBufferObject(context);
    this.initializeProgram(context);
  }

  render(context: esri.RenderContext) {
    const gl = context.gl;

    const { program, uniformLocations } = this.program;
    const { camera, sunLight } = context;

    // Setup program and uniforms
    gl.useProgram(program);

    // Set camera view and projection matrices
    gl.uniformMatrix4fv(uniformLocations.uProjectionMatrix, false, camera.projectionMatrix);

    // Set lighting parameters
    gl.uniform3fv(uniformLocations.uDirectionalColor, this.intensityMultipliedColor(sunLight.diffuse));
    gl.uniform3fv(uniformLocations.uAmbientColor, this.intensityMultipliedColor(sunLight.ambient));
    gl.uniform3fv(uniformLocations.uLightingDirection, context.sunLight.direction);

    // Bind vertex buffer object and setup attribute pointers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    gl.enableVertexAttribArray(this.vertexPositionAttributeLocation);
    gl.enableVertexAttribArray(this.vertexNormalAttributeLocation);

    // Vertex position
    gl.vertexAttribPointer(this.vertexPositionAttributeLocation, 3, gl.FLOAT, false, 24, 0);

    // Vertex normal
    gl.vertexAttribPointer(this.vertexNormalAttributeLocation, 3, gl.FLOAT, false, 24, 12);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);

    for (const object of this.objects) {
        const viewMatrix = glMatrix.mat4.translate(new Array(16) as any, camera.viewMatrix, object.origin);

      gl.uniformMatrix4fv(uniformLocations.uViewMatrix, false, viewMatrix);
      gl.uniformMatrix4fv(uniformLocations.uModelMatrix, false, object.modelMatrix);
      gl.uniformMatrix3fv(uniformLocations.uNormalMatrix, false, object.normalMatrix);

      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    // Make sure to reset the WebGL state when finishing the render
    context.resetWebGLState();
  }

  add(point: esri.Point) {
    if (!point) {
      return;
    }

    const origin = this.useLocalOrigin ? [3867591.281442831, 385734.3844961442, 5057029.372984918] : [0, 0, 0];
    const modelMatrix = externalRenderers.renderCoordinateTransformAt(view, [point.x, point.y, point.z], point.spatialReference, null);

    // Subtract local origin from the modelMatrix
    modelMatrix[12] -= origin[0];
    modelMatrix[13] -= origin[1];
    modelMatrix[14] -= origin[2];

    this.objects.push({
      origin,
      modelMatrix,
      normalMatrix: glMatrix.mat3.normalFromMat4(new Array(9) as any, modelMatrix as any) as any
    });

    externalRenderers.requestRender(view);

    log.timeout("Added new cube");
  }

  private intensityMultipliedColor(colorDef: any) {
    const { color, intensity } = colorDef;

    return [
      color[0] * intensity,
      color[1] * intensity,
      color[2] * intensity
    ];
  }

  private initializeVertexBufferObject(context: esri.RenderContext) {
    const gl = context.gl;

    this.vbo = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, createCubeGeometry(2), gl.STATIC_DRAW);
  }

  private initializeProgram(context: esri.RenderContext) {
    const gl = context.gl;

    this.program = createProgram(gl, "render",
      // Vertex shader
      `
        precision highp float;

        attribute vec3 aVertexPosition;
        attribute vec3 aVertexNormal;

        uniform mat4 uModelMatrix;
        uniform mat4 uViewMatrix;
        uniform mat4 uProjectionMatrix;
        uniform mat3 uNormalMatrix;

        uniform vec3 uAmbientColor;
        uniform vec3 uLightingDirection;
        uniform vec3 uDirectionalColor;

        varying vec3 vLightColor;

        void main(void) {
          gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aVertexPosition, 1.0);
          vec3 transformedNormal = normalize(uNormalMatrix * aVertexNormal);

          float directionalLightWeighting = max(dot(transformedNormal, uLightingDirection), 0.0);
          vLightColor = uAmbientColor + uDirectionalColor * directionalLightWeighting;
        }
      `,

      // Fragment shader
      `
        precision highp float;

        varying vec3 vLightColor;

        void main() {
          gl_FragColor = vec4(vLightColor, 1);
        }
      `,

      // Uniform names
      ["uModelMatrix", "uViewMatrix", "uProjectionMatrix", "uNormalMatrix", "uDirectionalColor", "uAmbientColor", "uLightingDirection"]
    );

    this.vertexPositionAttributeLocation = gl.getAttribLocation(this.program.program, "aVertexPosition");
    this.vertexNormalAttributeLocation = gl.getAttribLocation(this.program.program, "aVertexNormal");
  }
}

let renderer: CustomRenderer;

export function initialize() {
  view = new SceneView({
    container: "viewDiv",

    map: new Map({
      basemap: "satellite",
      ground: "world-elevation"
    }),

    camera: {
      position: [5.694, 52.453, 85.24],
      heading: 32.06,
      tilt: 66.08
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
      components: ["compass"]
    } as any
  });



  view.then(() => {
    // Create the custom renderer and add it to the view
    renderer = new CustomRenderer();
    externalRenderers.add(view, renderer);

    view.on("click", (event: any) => {
      renderer.add(event.mapPoint);
    });

    addWidget(view, `<div><input type="checkbox"> Enable local origins</div>`, {
      click: (event: any) => {
        renderer.useLocalOrigin = event.target.checked;
      }
    });
  });

}


