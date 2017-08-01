define(["require", "exports", "esri/Map", "esri/views/SceneView", "esri/views/3d/externalRenderers", "./support/webglUtils", "./support/log", "./support/widgets", "https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.3.2/gl-matrix-min.js"], function (require, exports, Map, SceneView, externalRenderers, webglUtils_1, log, widgets_1, glMatrix) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;
    class CustomRenderer {
        constructor() {
            this._enableLighting = false;
            this.objects = [];
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
            gl.uniformMatrix4fv(uniformLocations.uViewMatrix, false, camera.viewMatrix);
            gl.uniformMatrix4fv(uniformLocations.uProjectionMatrix, false, camera.projectionMatrix);
            // Set lighting parameters
            gl.uniform3fv(uniformLocations.uDirectionalColor, this.intensityMultipliedColor(sunLight.diffuse));
            gl.uniform3fv(uniformLocations.uAmbientColor, this.intensityMultipliedColor(sunLight.ambient));
            gl.uniform3fv(uniformLocations.uLightingDirection, sunLight.direction);
            gl.uniform1f(uniformLocations.uEnableLighting, this.enableLighting ? 1 : 0);
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
            const modelMatrix = externalRenderers.renderCoordinateTransformAt(view, [point.x, point.y, point.z], point.spatialReference, null);
            this.objects.push({
                modelMatrix,
                normalMatrix: glMatrix.mat3.normalFromMat4(new Array(9), modelMatrix)
            });
            externalRenderers.requestRender(view);
            log.timeout("Added new cube");
        }
        get enableLighting() {
            return this._enableLighting;
        }
        set enableLighting(value) {
            this._enableLighting = value;
            externalRenderers.requestRender(view);
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
            gl.bufferData(gl.ARRAY_BUFFER, webglUtils_1.createCubeGeometry(100000), gl.STATIC_DRAW);
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

        uniform float uEnableLighting;

        varying vec3 vLightColor;

        void main() {
          gl_FragColor = vec4(mix(vLightColor, vec3(1, 1, 1), 1.0 - uEnableLighting), 1);
        }
      `, 
            // Uniform names
            ["uModelMatrix", "uViewMatrix", "uProjectionMatrix", "uNormalMatrix", "uDirectionalColor", "uAmbientColor", "uLightingDirection", "uEnableLighting"]);
            this.vertexPositionAttributeLocation = gl.getAttribLocation(this.program.program, "aVertexPosition");
            this.vertexNormalAttributeLocation = gl.getAttribLocation(this.program.program, "aVertexNormal");
        }
    }
    let renderer;
    function initialize() {
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
        });
        view.then(() => {
            // Create the custom renderer and add it to the view
            renderer = new CustomRenderer();
            externalRenderers.add(view, renderer);
            widgets_1.add(view, `<div><input type="checkbox"><span style="color:red"> Enable lighting </span></div>`, {
                click: (event) => {
                    renderer.enableLighting = event.target.checked;
                }
            });
            widgets_1.add(view, `<div><input type="range" min="6" max="22" step="0.1" style="width: 200px" value="${view.environment.lighting.date.getHours() + view.environment.lighting.date.getMinutes() / 60}"></div>`, {
                input: (event) => {
                    const minutes = (event.target.value % 1) * 60;
                    const hours = Math.floor(event.target.value);
                    const date = new Date(view.environment.lighting.date.getTime());
                    date.setMinutes(minutes);
                    date.setHours(hours);
                    view.environment.lighting.date = date;
                }
            });
            view.on("click", (event) => {
                renderer.add(event.mapPoint);
            });
        });
    }
    exports.initialize = initialize;
});
//# sourceMappingURL=02-basic-camera-and-lighting.js.map