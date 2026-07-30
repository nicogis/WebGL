define(["require", "exports", "esri/Map", "esri/geometry/ScreenPoint", "esri/views/SceneView", "esri/views/3d/externalRenderers", "./support/log"], function (require, exports, Map, ScreenPoint, SceneView, externalRenderers, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;

    const WHEEL_FRONT_NAMES = ["subD_RAD_VL", "subD_RAD_VR"];
    const WHEEL_REAR_NAMES  = ["subD_RAD_H1", "subD_RAD_H2"];
    const WHEEL_SPEED   = 0.05;
    const BRUSH_SPEED   = 0.15;
    const MOVE_STEP_M   = 0.5;   // metri per frame

    function applyLocalOrientation(object, rotationY) {
        object.rotation.x = -Math.PI / 2;
        object.rotation.z = Math.PI;
        object.rotation.y = rotationY;
    }

    // Con rotation.x=-PI/2 e rotation.z=PI il fronte del modello punta lungo +X locale.
    // In Web Mercator Y-nord, X-est:
    //   fronte(rotation.y=0) → est (+X)
    //   direzione effettiva  → bearing = PI/2 - rotation.y  (ruota antiorario)
    function movePoint(point, headingRad, meters) {
        // bearing geografico: 0=nord, PI/2=est, PI=sud, -PI/2=ovest
        // con rotation.z=PI il modello è specchiato → il fronte con rotation.y=0 è EST
        // quindi: bearing = PI/2 - headingRad
        const bearing = Math.PI / 2 - headingRad;

        const wkid = point.spatialReference && point.spatialReference.wkid;
        const isWebMercator = (wkid === 102100 || wkid === 3857);

        let newX, newY;
        if (isWebMercator) {
            // Web Mercator: X=est, Y=nord — spostamento diretto in metri
            newX = point.x + Math.sin(bearing) * meters;
            newY = point.y + Math.cos(bearing) * meters;
        } else {
            // WGS84 gradi
            const R      = 6378137;
            const latRad = point.y * Math.PI / 180;
            const dLat   = (Math.cos(bearing) * meters) / R;
            const dLon   = (Math.sin(bearing) * meters) / (R * Math.cos(latRad));
            newX = point.x + dLon * (180 / Math.PI);
            newY = point.y + dLat * (180 / Math.PI);
        }

        if (point.clone) {
            const np = point.clone();
            np.x = newX;
            np.y = newY;
            return np;
        }
        return { x: newX, y: newY, z: point.z, spatialReference: point.spatialReference };
    }

    function createBrush(radius, numSectors) {
        const outerGroup = new THREE.Group();
        const innerGroup = new THREE.Group();
        outerGroup.add(innerGroup);
        innerGroup.rotation.x = -Math.PI / 2;

        const mat0 = new THREE.MeshLambertMaterial({ color: 0xff4400, side: THREE.DoubleSide });
        const mat1 = new THREE.MeshLambertMaterial({ color: 0xffcc00, side: THREE.DoubleSide });
        const arcSteps    = 12;
        const gapFraction = 0.18;

        for (let i = 0; i < numSectors; i++) {
            const a0 = (i / numSectors) * Math.PI * 2;
            const a1 = ((i + 1 - gapFraction) / numSectors) * Math.PI * 2;
            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            for (let s = 0; s <= arcSteps; s++) {
                const a = a0 + (a1 - a0) * s / arcSteps;
                shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
            }
            shape.lineTo(0, 0);
            innerGroup.add(new THREE.Mesh(
                new THREE.ShapeGeometry(shape),
                i % 2 === 0 ? mat0 : mat1
            ));
        }
        return outerGroup;
    }

    class CustomRenderer {
        constructor() {
            this.animations    = [];
            this.rotation      = 0;
            this.baseScale     = 2;
            this.objectWrapper = null;
            this.object        = null;
            this.point         = null;
            this.placed        = false;
            this.moving        = false;
            this.wheelsFront   = [];
            this.wheelsRear    = [];
            this.brushL        = null;
            this.brushR        = null;
            this._dragLastX    = null;
            this._rotateSensitivity = 0.01;
        }
        setup(context) {
            this.initializeRenderer(context);
            this.initializeCamera(context);
            this.initializeScene(context);
        }
        render(context) {
            this.updateCamera(context);
            this.updateLights(context);

            if (this.moving && this.point != null && this.objectWrapper != null) {
                this.point = movePoint(this.point, this.rotation, MOVE_STEP_M);
                this.applyWrapperTransformAt(this.point);
            }

            this.wheelsFront.forEach(w => { w.rotation.x += WHEEL_SPEED; });
            this.wheelsRear.forEach(w  => { w.rotation.x += WHEEL_SPEED; });

            const pulisci = document.getElementById("chkPulisci");
            if (pulisci && pulisci.checked) {
                if (this.brushL) this.brushL.rotation.y += BRUSH_SPEED;
                if (this.brushR) this.brushR.rotation.y -= BRUSH_SPEED;
            }

            this.renderer.resetGLState();
            this.renderer.render(this.scene, this.camera);
            context.resetWebGLState();
            externalRenderers.requestRender(view);
        }
        add(location) {
            if (this.object == null) {
                this.point = location;
                this.addColladaModel(this.point);
                log.timeout("Added sweeper");
            } else {
                this.placed = true;
                this.point  = location;
                this.applyWrapperTransformAt(location);
                externalRenderers.requestRender(view);
                log.timeout("Sweeper placed");
                const btn = document.getElementById("btnMoveForward");
                if (btn) btn.disabled = false;
            }
        }
        toggleMoving() {
            if (this.object == null || this.objectWrapper == null || this.point == null) return;
            this.placed = true;
            this.moving = !this.moving;
            const btn = document.getElementById("btnMoveForward");
            if (btn) btn.textContent = this.moving ? "⏹ Stop" : "▶ Play";
            log.timeout(this.moving ? "Moving..." : "Stopped");
        }
        addColladaModel(location) {
            const loader = new THREE.ColladaLoader();
            loader.load("./app/data/sweeper.dae", (collada) => {
                this.object = collada.scene;
                this.objectWrapper = new THREE.Group();
                this.objectWrapper.add(this.object);
                applyLocalOrientation(this.object, this.rotation);
                this.applyWrapperTransformAt(location);
                this.scene.add(this.objectWrapper);

                this.wheelsFront = [];
                this.wheelsRear  = [];
                this.object.traverse((node) => {
                    if (WHEEL_FRONT_NAMES.includes(node.name)) this.wheelsFront.push(node);
                    if (WHEEL_REAR_NAMES.includes(node.name))  this.wheelsRear.push(node);
                });

                this.objectWrapper.remove(this.object);
                this.object.rotation.set(0, 0, 0);
                this.object.updateMatrixWorld(true);

                const bbox = new THREE.Box3().setFromObject(this.object);
                const size = new THREE.Vector3();
                bbox.getSize(size);

                const wheelFL = this.wheelsFront.find(w => w.name === "subD_RAD_VL");
                const wFL = new THREE.Vector3();
                if (wheelFL) wheelFL.getWorldPosition(wFL);

                this.object.rotation.set(-Math.PI / 2, this.rotation, Math.PI);
                this.objectWrapper.add(this.object);
                this.object.updateMatrixWorld(true);

                const brushRadius = size.x * 3.50;
                const groundY     = bbox.min.y;
                const frontZ      = wFL.z + brushRadius * 2.5;
                const outset      = brushRadius * 3.50;
                const brushX_L    = bbox.min.x - outset;
                const brushX_R    = bbox.max.x + outset;

                this.brushL = createBrush(brushRadius, 8);
                this.brushL.position.set(brushX_L, groundY, frontZ);
                this.object.add(this.brushL);

                this.brushR = createBrush(brushRadius, 8);
                this.brushR.position.set(brushX_R, groundY, frontZ);
                this.object.add(this.brushR);

                externalRenderers.requestRender(view);
            });
        }
        bearing(p1, p2) {
            var dLon = (p2.x - p1.x);
            var y = Math.sin(dLon) * Math.cos(p2.y);
            var x = Math.cos(p1.y) * Math.sin(p2.y) - Math.sin(p1.y) * Math.cos(p2.y) * Math.cos(dLon);
            var brng = Math.atan2(y, x);
            return 2 * Math.PI - ((brng + (2 * Math.PI)) % (2 * Math.PI));
        }
        update(renderAt) {
            if (this.placed) return;
            if (this.objectWrapper != null) {
                const pt = view.toMap(new ScreenPoint(renderAt.x, renderAt.y));
                if (pt != null) {
                    this.point = pt;
                    this.applyWrapperTransformAt(this.point);
                    applyLocalOrientation(this.object, this.rotation);
                    this.objectWrapper.updateMatrixWorld(true);
                    externalRenderers.requestRender(view);
                }
            }
        }
        startDragRotate(x) { this._dragLastX = x; }
        updateDragRotate(x) {
            if (this._dragLastX === null || !this.objectWrapper) return;
            const dx = x - this._dragLastX;
            this.rotation += dx * this._rotateSensitivity;
            applyLocalOrientation(this.object, this.rotation);
            this.objectWrapper.updateMatrixWorld(true);
            externalRenderers.requestRender(view);
            this._dragLastX = x;
            log.timeout("Heading: " + Math.round(this.rotation * 180 / Math.PI) + "°");
        }
        endDragRotate() { this._dragLastX = null; }
        rotate() {
            if (this.point != null && this.objectWrapper != null) {
                this.rotation += 0.05;
                this.applyWrapperTransformAt(this.point);
                applyLocalOrientation(this.object, this.rotation);
                this.objectWrapper.updateMatrixWorld(true);
                externalRenderers.requestRender(view);
            }
        }
        applyWrapperTransformAt(location) {
            const transform = new THREE.Matrix4();
            const z = (location.z !== undefined && !isNaN(location.z)) ? location.z + 5 : 5;
            externalRenderers.renderCoordinateTransformAt(
                view, [location.x, location.y, z],
                location.spatialReference, transform.elements
            );
            transform.decompose(this.objectWrapper.position, this.objectWrapper.quaternion, this.objectWrapper.scale);
            this.objectWrapper.scale.set(this.baseScale, this.baseScale, this.baseScale);
        }
        initializeRenderer(context) {
            this.renderer = new THREE.WebGLRenderer({ context: context.gl, premultipliedAlpha: false });
            this.renderer.autoClearDepth = false;
            this.renderer.autoClearStencil = false;
            this.renderer.autoClearColor = false;
            const originalSetRenderTarget = this.renderer.setRenderTarget.bind(this.renderer);
            this.renderer.setRenderTarget = (target) => {
                originalSetRenderTarget(target);
                if (target == null) context.bindRenderTarget();
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
            map: new Map({ basemap: "streets", ground: "world-elevation" }),
            camera: { position: [4.498, 51.908, 250], heading: 269.52, tilt: 64.54 },
            qualityProfile: "high",
            environment: {
                atmosphere: { quality: "high" },
                lighting: { directShadowsEnabled: true, ambientOcclusionEnabled: true }
            },
            ui: { components: ["compass"] }
        });
        view.then(() => {
            renderer = new CustomRenderer();
            externalRenderers.add(view, renderer);

            const btn = document.getElementById("btnMoveForward");
            if (btn) {
                btn.addEventListener("click", () => renderer.toggleMoving());
            }

            view.on("click", (event) => {
                if (event.native && event.native.shiftKey) return;
                let mapPoint = event.mapPoint;
                if (!mapPoint) mapPoint = view.toMap(new ScreenPoint(event.x, event.y));
                if (mapPoint) renderer.add(mapPoint);
            });
            view.on("pointer-move", (event) => {
                renderer.update(new ScreenPoint(event.x, event.y));
            });
            view.on("drag", (event) => {
                if (!event.native.shiftKey) return;
                event.stopPropagation();
                if (event.action === "start")                                 renderer.startDragRotate(event.x);
                else if (event.action === "update")                           renderer.updateDragRotate(event.x);
                else if (event.action === "end" || event.action === "cancel") renderer.endDragRotate();
            });
            view.on("key-down", (event) => { if (event.key === "r") renderer.rotate(); });
        });
    }
    exports.initialize = initialize;
});
//# sourceMappingURL=main.js.map