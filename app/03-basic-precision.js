define(["require", "exports", "esri/Map", "esri/views/SceneView", "esri/views/3d/externalRenderers", "./support/webglUtils", "./support/log", "./support/widgets", "https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.3.2/gl-matrix-min.js"], function (require, exports, Map, SceneView, externalRenderers, webglUtils_1, log, widgets_1, glMatrix) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;
    class CustomRenderer {
        constructor() {
            this.objects = [];
            this.useLocalOrigin = false;
        }
        setup(context) {
            const gl = context.gl;
            this.renderAt = null;
            this.initializeVertexBufferObject(context);
            this.initializeProgram(context);
        }
        render(context) {
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
                const viewMatrix = glMatrix.mat4.translate(new Array(16), camera.viewMatrix, object.origin);
                gl.uniformMatrix4fv(uniformLocations.uViewMatrix, false, viewMatrix);
                gl.uniformMatrix4fv(uniformLocations.uModelMatrix, false, object.modelMatrix);
                gl.uniformMatrix3fv(uniformLocations.uNormalMatrix, false, object.normalMatrix);
                gl.drawArrays(gl.TRIANGLES, 0, 36);
            }
            // Make sure to reset the WebGL state when finishing the render
            context.resetWebGLState();
        }
        add(point) {
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
                normalMatrix: glMatrix.mat3.normalFromMat4(new Array(9), modelMatrix)
            });
            externalRenderers.requestRender(view);
            log.timeout("Added new cube");
        }
        intensityMultipliedColor(colorDef) {
            const { color, intensity } = colorDef;
            return [
                color[0] * intensity,
                color[1] * intensity,
                color[2] * intensity
            ];
        }
        initializeVertexBufferObject(context) {
            const gl = context.gl;
            this.vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, webglUtils_1.createCubeGeometry(2), gl.STATIC_DRAW);
        }
        initializeProgram(context) {
            const gl = context.gl;
            this.program = webglUtils_1.createProgram(gl, "render", 
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
            ["uModelMatrix", "uViewMatrix", "uProjectionMatrix", "uNormalMatrix", "uDirectionalColor", "uAmbientColor", "uLightingDirection"]);
            this.vertexPositionAttributeLocation = gl.getAttribLocation(this.program.program, "aVertexPosition");
            this.vertexNormalAttributeLocation = gl.getAttribLocation(this.program.program, "aVertexNormal");
        }
    }
    let renderer;
    function initialize() {
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
            }
        });
        view.then(() => {
            // Create the custom renderer and add it to the view
            renderer = new CustomRenderer();
            externalRenderers.add(view, renderer);
            view.on("click", (event) => {
                renderer.add(event.mapPoint);
            });
            widgets_1.add(view, `<div><input type="checkbox"> Enable local origins</div>`, {
                click: (event) => {
                    renderer.useLocalOrigin = event.target.checked;
                }
            });
        });
    }
    exports.initialize = initialize;
});
//# sourceMappingURL=03-basic-precision.js.map