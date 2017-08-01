define(["require", "exports", "esri/Map", "esri/layers/Layer", "esri/views/SceneView", "esri/views/3d/externalRenderers", "./support/log"], function (require, exports, Map, Layer, SceneView, externalRenderers, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;
    class CustomRenderer {
        constructor() {
            this.animations = [];
        }
        setup(context) {
            this.initializeRenderer(context);
            this.initializeCamera(context);
            this.initializeScene(context);
        }
        render(context) {
            this.updateCamera(context);
            this.updateLights(context);
            this.updateAnimation();
            this.renderer.resetGLState();
            this.renderer.render(this.scene, this.camera);
            context.resetWebGLState();
            if (this.animations.length) {
                externalRenderers.requestRender(view);
            }
        }
        add(point) {
            this.addColladaModel(point);
            log.timeout("Added object");
        }
        addColladaModel(location) {
            const loader = new THREE.ColladaLoader();
            loader.load("./app/data/animated-object.dae", (collada) => {
                const object = collada.scene;
                this.applyTransformAt(object, location);
                object.scale.multiplyScalar(view.scale / 200);
                object.updateMatrix();
                this.scene.add(object);
                for (const animation of collada.animations) {
                    const keyFrameAnimation = new THREE.KeyFrameAnimation(animation);
                    keyFrameAnimation.timeScale = 1;
                    keyFrameAnimation.loop = false;
                    keyFrameAnimation.play(0);
                    this.animations.push(keyFrameAnimation);
                }
                externalRenderers.requestRender(view);
            });
        }
        updateAnimation() {
            for (const animation of this.animations) {
                if (animation.currentTime >= animation.data.length) {
                    animation.stop();
                    animation.play(0);
                }
                animation.update(1 / 60);
            }
        }
        initializeRenderer(context) {
            this.renderer = new THREE.WebGLRenderer({
                context: context.gl,
                premultipliedAlpha: false
            });
            // prevent three.js from clearing the buffers provided by the ArcGIS JS API.
            this.renderer.autoClearDepth = false;
            this.renderer.autoClearStencil = false;
            this.renderer.autoClearColor = false;
            // The ArcGIS JS API renders to custom offscreen buffers, and not to the default framebuffers.
            // We have to inject this bit of code into the three.js runtime in order for it to bind those
            // buffers instead of the default ones.
            const originalSetRenderTarget = this.renderer.setRenderTarget.bind(this.renderer);
            this.renderer.setRenderTarget = (target) => {
                originalSetRenderTarget(target);
                if (target == null) {
                    context.bindRenderTarget();
                }
            };
        }
        initializeCamera(context) {
            const camera = context.camera;
            this.camera = new THREE.PerspectiveCamera(camera.fovY, camera.aspect, camera.near, camera.far);
        }
        initializeScene(context) {
            this.scene = new THREE.Scene();
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            this.scene.add(this.ambientLight);
            this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
            this.scene.add(this.directionalLight);
        }
        applyTransformAt(object, location) {
            const transform = new THREE.Matrix4();
            externalRenderers.renderCoordinateTransformAt(view, [location.x, location.y, location.z + 0.5], location.spatialReference, transform.elements);
            transform.decompose(object.position, object.quaternion, object.scale);
        }
        updateCamera(context) {
            const camera = context.camera;
            this.renderer.setViewport(0, 0, view.width, view.height);
            this.camera.position.set(camera.eye[0], camera.eye[1], camera.eye[2]);
            this.camera.up.set(camera.up[0], camera.up[1], camera.up[2]);
            this.camera.lookAt(new THREE.Vector3(camera.center[0], camera.center[1], camera.center[2]));
            this.camera.projectionMatrix.fromArray(camera.projectionMatrix);
        }
        updateLights(context) {
            const { direction, diffuse, ambient } = context.sunLight;
            this.directionalLight.position.set(direction[0], direction[1], direction[2]);
            this.directionalLight.intensity = diffuse.intensity;
            this.directionalLight.color = new THREE.Color(diffuse.color[0], diffuse.color[1], diffuse.color[2]);
            this.ambientLight.intensity = ambient.intensity;
            this.ambientLight.color = new THREE.Color(ambient.color[0], ambient.color[1], ambient.color[2]);
        }
    }
    let renderer;
    function initialize() {
        view = new SceneView({
            container: "viewDiv",
            map: new Map({
                basemap: "streets",
                ground: "world-elevation"
            }),
            camera: {
                position: [4.498, 51.908, 383.19],
                heading: 269.52,
                tilt: 64.54
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
        Layer.fromArcGISServerUrl({ url: "https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/Building_Rotterdam/SceneServer" })
            .then(layer => {
            view.map.add(layer);
        });
        view.then(() => {
            // Create the custom renderer and add it to the view
            renderer = new CustomRenderer();
            externalRenderers.add(view, renderer);
            view.on("click", (event) => {
                if (event.mapPoint) {
                    renderer.add(event.mapPoint);
                }
            });
        });
    }
    exports.initialize = initialize;
});
//# sourceMappingURL=05-threejs-loader-animations.js.map