define(["require", "exports", "esri/Map", "esri/geometry/ScreenPoint", "esri/views/SceneView", "esri/views/3d/externalRenderers", "./support/webglUtils", "./support/log"], function (require, exports, Map, ScreenPoint, SceneView, externalRenderers, webglUtils_1, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;
    class CustomRenderer {
        setup(context) {
            const gl = context.gl;
            this.renderAt = null;
            this.initializeVertexBufferObject(context);
            this.initializeProgram(context);
        }
        render(context) {
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
        update(renderAt) {
            this.renderAt = renderAt;
            externalRenderers.requestRender(view);
        }
        initializeVertexBufferObject(context) {
            const gl = context.gl;
            this.vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.createBufferData(), gl.STATIC_DRAW);
        }
        initializeProgram(context) {
            this.program = webglUtils_1.createProgram(context.gl, "render", 
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
            ["uModelMatrix", "uViewMatrix", "uProjectionMatrix"]);
        }
        createBufferData() {
            const size = 500000;
            const halfWidth = 10000;
            // Create data for a simple render coordinate, X, Y, Z using triangles
            return new Float32Array([
                // X flat
                0, -halfWidth, 0,
                1, 0, 0,
                size, halfWidth, 0,
                1, 0, 0,
                size, -halfWidth, 0,
                1, 0, 0,
                0, -halfWidth, 0,
                1, 0, 0,
                0, halfWidth, 0,
                1, 0, 0,
                size, halfWidth, 0,
                1, 0, 0,
                // X up
                0, 0, 0,
                0.6, 0, 0,
                size, 0, 0,
                0.6, 0, 0,
                size, 0, halfWidth,
                0.6, 0, 0,
                0, 0, 0,
                0.6, 0, 0,
                size, 0, halfWidth,
                0.6, 0, 0,
                0, 0, halfWidth,
                0.6, 0, 0,
                // Y flat
                -halfWidth, 0, 0,
                0, 1, 0,
                halfWidth, size, 0,
                0, 1, 0,
                -halfWidth, size, 0,
                0, 1, 0,
                -halfWidth, 0, 0,
                0, 1, 0,
                halfWidth, 0, 0,
                0, 1, 0,
                halfWidth, size, 0,
                0, 1, 0,
                // Y up
                0, 0, 0,
                0, 0.6, 0,
                0, size, 0,
                0, 0.6, 0,
                0, size, halfWidth,
                0, 0.6, 0,
                0, 0, 0,
                0, 0.6, 0,
                0, size, halfWidth,
                0, 0.6, 0,
                0, 0, halfWidth,
                0, 0.6, 0,
                // Z on X
                -halfWidth, 0, 0,
                0, 0, 1,
                halfWidth, 0, 0,
                0, 0, 1,
                halfWidth, 0, size,
                0, 0, 1,
                -halfWidth, 0, 0,
                0, 0, 1,
                halfWidth, 0, size,
                0, 0, 1,
                -halfWidth, 0, size,
                0, 0, 1,
                // Z on Y
                0, -halfWidth, 0,
                0, 0, 0.6,
                0, halfWidth, 0,
                0, 0, 0.6,
                0, halfWidth, size,
                0, 0, 0.6,
                0, -halfWidth, 0,
                0, 0, 0.6,
                0, halfWidth, size,
                0, 0, 0.6,
                0, -halfWidth, size,
                0, 0, 0.6 // color
            ]);
        }
    }
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
            ui: {
                components: ["compass", "attribution"]
            }
        });
        view.then(() => {
            let isFixed = false;
            // Create the custom renderer and add it to the view
            let renderer = new CustomRenderer();
            externalRenderers.add(view, renderer);
            view.on("hold", (event) => {
                if (!isFixed && !event.mapPoint) {
                    return;
                }
                isFixed = !isFixed;
                renderer.update(new ScreenPoint({ x: event.x, y: event.y }));
                log.message(isFixed ? "Placed coordinate system" : "");
            });
            view.on("pointer-move", (event) => {
                if (!isFixed) {
                    renderer.update(new ScreenPoint({ x: event.x, y: event.y }));
                }
            });
        });
    }
    exports.initialize = initialize;
});
//# sourceMappingURL=01-basic-render-coordinate-system.js.map