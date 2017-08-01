define(["require", "exports", "esri/Map", "esri/layers/Layer", "esri/views/SceneView", "esri/views/3d/externalRenderers", "app/lib/threejs/three.min.js"], function (require, exports, Map, Layer, SceneView, externalRenderers, THREE) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;
    class CustomRenderer {
        constructor() {
            this.isDragging = false;
        }
        setup(context) {
            this.initializeRenderer(context);
            this.initializeCamera(context);
            this.initializeScene(context);
        }
        render(context) {
            if (this.screenMesh.visible) {
                this.updateCamera(context);
                this.updateLights(context);
                this.updateVideo(context);
                this.renderer.resetGLState();
                this.renderer.render(this.scene, this.camera);
            }
            context.resetWebGLState();
            if (!this.videoElement.paused) {
                externalRenderers.requestRender(view);
            }
        }
        updateDrag(event) {
            event.stopPropagation();
            switch (event.action) {
                case "start": {
                    const mapPoint = view.toMap(event.x, event.y);
                    if (!mapPoint) {
                        return;
                    }
                    // Set the position of the box, don't show it yet
                    this.dragOriginTransform = new THREE.Matrix4();
                    this.dragOriginTransform.fromArray(externalRenderers.renderCoordinateTransformAt(view, [mapPoint.x, mapPoint.y, mapPoint.z], mapPoint.spatialReference, null));
                    this.dragOriginTransformInverse = new THREE.Matrix4();
                    this.dragOriginTransformInverse.getInverse(this.dragOriginTransform);
                    this.isDragging = true;
                    externalRenderers.requestRender(view);
                    this.videoElement.currentTime = 0;
                    this.videoElement.pause();
                    this.videoTexture.needsUpdate = true;
                    externalRenderers.requestRender(view);
                    break;
                }
                case "update": {
                    if (!this.isDragging) {
                        return;
                    }
                    const mapPoint = view.toMap(event.x, event.y);
                    if (!mapPoint) {
                        return;
                    }
                    const location = externalRenderers.toRenderCoordinates(view, [mapPoint.x, mapPoint.y, mapPoint.z], 0, mapPoint.spatialReference, [0, 0, 0], 0, 1);
                    const localLocation = new THREE.Vector3(location[0], location[1], location[2]);
                    localLocation.applyMatrix4(this.dragOriginTransformInverse);
                    const angle = Math.atan2(localLocation.y, localLocation.x);
                    const transform = this.dragOriginTransform.clone();
                    const rotation = new THREE.Matrix4();
                    rotation.makeRotationZ(angle);
                    transform.multiply(rotation);
                    transform.decompose(this.screenMesh.position, this.screenMesh.quaternion, this.screenMesh.scale);
                    // Use location as a local origin when rendering
                    this.screenMesh.position.set(0, 0, 0);
                    const inverseTransform = new THREE.Matrix4();
                    inverseTransform.getInverse(transform);
                    const localVector = new THREE.Vector3(location[0], location[1], location[2]);
                    localVector.applyMatrix4(inverseTransform);
                    const xsize = Math.abs(localVector.x);
                    this.screenMesh.scale.set(xsize * 2, 2, xsize * 2 / 16 * 9);
                    this.screenMesh.visible = xsize > 1;
                    externalRenderers.requestRender(view);
                    break;
                }
                case "end": {
                    this.isDragging = false;
                    externalRenderers.requestRender(view);
                    break;
                }
            }
        }
        click(event) {
            if (this.intersectsScreenMesh(event.x, event.y)) {
                if (this.videoElement.paused) {
                    this.videoElement.play();
                }
                else {
                    this.videoElement.pause();
                }
                externalRenderers.requestRender(view);
                event.stopPropagation();
            }
        }
        hold(x, y) {
            if (this.intersectsScreenMesh(x, y)) {
                this.videoElement.currentTime = 0;
                this.videoTexture.needsUpdate = true;
                externalRenderers.requestRender(view);
            }
        }
        intersectsScreenMesh(x, y) {
            if (!this.screenMesh.visible) {
                return false;
            }
            x = (x / view.width) * 2 - 1;
            y = ((view.height - y) / view.height) * 2 - 1;
            const mouse = new THREE.Vector2(x, y);
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);
            return raycaster.intersectObject(this.screenMesh).length !== 0;
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
        initializeVideo() {
            const video = document.createElement("video");
            const videoUrl = "././app/data/the-power-of-maps.mp4";
            video.style.display = "none";
            video.autoplay = false;
            video.loop = false;
            video.src = videoUrl;
            video.pause();
            document.body.appendChild(video);
            this.videoElement = video;
            this.videoTexture = new THREE.Texture(this.videoElement);
            this.videoTexture.minFilter = THREE.LinearFilter;
            this.videoTexture.magFilter = THREE.LinearFilter;
        }
        initializeScene(context) {
            this.scene = new THREE.Scene();
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            this.scene.add(this.ambientLight);
            this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
            this.scene.add(this.directionalLight);
            this.initializeVideo();
            const geometry = new THREE.BoxBufferGeometry(1, 1, 1);
            const material = new THREE.MeshPhongMaterial({ color: "#ccc", map: this.videoTexture });
            const mesh = new THREE.Mesh(geometry, material);
            this.screenMesh = mesh;
            this.screenMesh.visible = false;
            this.scene.add(mesh);
        }
        applyTransformAt(object, location) {
            const transform = new THREE.Matrix4();
            externalRenderers.renderCoordinateTransformAt(view, [location.x, location.y, location.z], location.spatialReference, transform.elements);
            transform.decompose(object.position, object.quaternion, object.scale);
        }
        updateVideo(context) {
            if (!this.videoElement.paused) {
                this.videoTexture.needsUpdate = true;
            }
        }
        updateCamera(context) {
            const camera = context.camera;
            this.renderer.setViewport(0, 0, view.width, view.height);
            const origin = new THREE.Vector3();
            origin.setFromMatrixPosition(this.dragOriginTransform);
            this.camera.position.set(camera.eye[0] - origin.x, camera.eye[1] - origin.y, camera.eye[2] - origin.z);
            this.camera.up.set(camera.up[0], camera.up[1], camera.up[2]);
            this.camera.lookAt(new THREE.Vector3(camera.center[0] - origin.x, camera.center[1] - origin.y, camera.center[2] - origin.z));
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
                basemap: "hybrid",
                ground: "world-elevation"
            }),
            camera: {
                position: [-73.982, 40.736, 1184.67],
                heading: 346.67,
                tilt: 54.98
            },
            qualityProfile: "high",
            environment: {
                atmosphere: {
                    quality: "high"
                },
                lighting: {
                    directShadowsEnabled: true,
                    ambientOcclusionEnabled: true,
                    date: new Date("Tue Dec 15 2015 19:25:00 GMT+0100 (CET)")
                }
            },
            ui: {
                components: ["compass"]
            }
        });
        Layer.fromArcGISServerUrl({ url: "http://tiles.arcgis.com/tiles/z2tnIkrLQ2BRzr6P/arcgis/rest/services/New_York_LoD2_3D_Buildings/SceneServer/layers/0" })
            .then((layer) => {
            view.map.add(layer);
        });
        view.then(() => {
            // Create the custom renderer and add it to the view
            renderer = new CustomRenderer();
            externalRenderers.add(view, renderer);
            view.on("drag", ["Ctrl"], (event) => {
                renderer.updateDrag(event);
            });
            view.on("click", (event) => {
                renderer.click(event);
            });
            view.on("hold", (event) => {
                renderer.hold(event.x, event.y);
                event.stopPropagation();
            });
        });
    }
    exports.initialize = initialize;
});
//# sourceMappingURL=06-threejs-video-textures.js.map