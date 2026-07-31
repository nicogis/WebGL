define(["require", "exports", "esri/Map", "esri/geometry/ScreenPoint", "esri/views/SceneView", "esri/views/3d/externalRenderers", "esri/geometry/support/webMercatorUtils", "./support/log"], function (require, exports, Map, ScreenPoint, SceneView, externalRenderers, webMercatorUtils, log) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    let view;

    const WHEEL_FRONT_NAMES    = ["subD_RAD_VL", "subD_RAD_VR"];
    const WHEEL_REAR_NAMES     = ["subD_RAD_H1", "subD_RAD_H2"];
    const WHEEL_SPEED          = 0.02;
    const BRUSH_SPEED          = 0.06;
    const MOVE_STEP_M          = 0.15;
    const MODEL_GROUND_OFFSET_ROUTE = -4;
    const MODEL_GROUND_OFFSET_PLACE =  1;

    const ROUTE_PATH_WGS84 = [
        [4.4962978700000349, 51.893550343000072],
        [4.4962241000000631, 51.893512100000066],
        [4.4947017000000642, 51.892649900000038],
        [4.4977023000000713, 51.891012600000067],
        [4.497890600000062,  51.890886600000044],
        [4.4979906000000369, 51.890819700000065],
        [4.4980954000000679, 51.890749600000049],
        [4.5015567000000374, 51.892665500000078],
        [4.5017527000000541, 51.892772200000081],
        [4.5027814000000603, 51.893343700000059],
        [4.5034408000000212, 51.89370480000008],
        [4.5037707000000751, 51.893884400000047],
        [4.5039540000000216, 51.893984100000068],
        [4.5051674000000617, 51.893127800000059],
        [4.5056502000000478, 51.893392600000027],
        [4.5061294000000203, 51.893640800000071],
        [4.5060913150000488, 51.893666155000062]
    ];

    // Un valore per ogni segmento (16 segmenti = 17 punti - 1).
    // true  → spazzole attive in quel tratto
    // false → spazzole ferme
    const ROUTE_BRUSH_ACTIVE = [
        true,   // segmento 0  (punto 0 → 1)
        true,   // segmento 1  (punto 1 → 2)
        true,   // segmento 2  (punto 2 → 3)
        false,  // segmento 3  (punto 3 → 4)
        false,  // segmento 4  (punto 4 → 5)
        true,   // segmento 5  (punto 5 → 6)
        true,   // segmento 6  (punto 6 → 7)
        false,  // segmento 7  (punto 7 → 8)
        true,   // segmento 8  (punto 8 → 9)
        true,   // segmento 9  (punto 9 → 10)
        false,  // segmento 10 (punto 10 → 11)
        false,  // segmento 11 (punto 11 → 12)
        true,   // segmento 12 (punto 12 → 13)
        false,   // segmento 13 (punto 13 → 14)
        true,   // segmento 14 (punto 14 → 15)
        true,   // segmento 15 (punto 15 → 16)
    ];

    function applyLocalOrientation(object, rotationY) {
        object.rotation.x = -Math.PI / 2;
        object.rotation.z = Math.PI;
        object.rotation.y = rotationY;
    }

    // Bearing geografico (radianti) da [lng1,lat1] → [lng2,lat2]
    // 0=nord, π/2=est (senso orario), range [-π, π]
    function geoBearing(lng1, lat1, lng2, lat2) {
        const lat1r = lat1 * Math.PI / 180;
        const lat2r = lat2 * Math.PI / 180;
        const dLon  = (lng2 - lng1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2r);
        const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
        return Math.atan2(y, x);
    }

    // Distanza in metri tra due punti WGS84 (haversine)
    function haversineDistance(lng1, lat1, lng2, lat2) {
        const R    = 6378137;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lng2 - lng1) * Math.PI / 180;
        const a    = Math.sin(dLat / 2) ** 2
                   + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
                   * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Converte un bearing geografico in rotation.y per il modello.
    // Convenzione base: rotation.y = π/2 - bearing
    // Correzione imbardata 180° per i quadranti SE (bearing ∈ (π/2,π))
    // e NW (bearing ∈ (-π/2,0)), identificati da sin(2·bearing) < 0.
    function bearingToRotation(bearing) {
        let r = Math.PI / 2 - bearing;
        if (Math.sin(2 * bearing) < 0) r += Math.PI;
        return r;
    }

    // Sposta un Point ArcGIS lungo un bearing geografico (rad) di `meters` metri.
    function movePoint(point, bearingRad, meters) {
        const wkid = point.spatialReference && point.spatialReference.wkid;
        const isWebMercator = (wkid === 102100 || wkid === 3857);

        let geoPoint = isWebMercator
            ? webMercatorUtils.webMercatorToGeographic(point)
            : point;

        const R      = 6378137;
        const latRad = geoPoint.y * Math.PI / 180;
        const dLat   = (Math.cos(bearingRad) * meters) / R;
        const dLon   = (Math.sin(bearingRad) * meters) / (R * Math.cos(latRad));

        const moved  = geoPoint.clone();
        moved.x = geoPoint.x + dLon * (180 / Math.PI);
        moved.y = geoPoint.y + dLat * (180 / Math.PI);

        return isWebMercator
            ? webMercatorUtils.geographicToWebMercator(moved)
            : moved;
    }

    // Restituisce [lng, lat] WGS84 del Point ArcGIS
    function pointToWGS84(point) {
        const wkid = point.spatialReference && point.spatialReference.wkid;
        const isWebMercator = (wkid === 102100 || wkid === 3857);
        const geoPoint = isWebMercator
            ? webMercatorUtils.webMercatorToGeographic(point)
            : point;
        return [geoPoint.x, geoPoint.y];
    }

    function createBrush(radius, numSectors) {
        const outerGroup = new THREE.Group();
        const innerGroup = new THREE.Group();
        outerGroup.add(innerGroup);
        innerGroup.rotation.x = -Math.PI / 2;
        const mat0 = new THREE.MeshLambertMaterial({ color: 0xff4400, side: THREE.DoubleSide });
        const mat1 = new THREE.MeshLambertMaterial({ color: 0xffcc00, side: THREE.DoubleSide });
        const arcSteps = 12, gapFraction = 0.18;
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
            innerGroup.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), i % 2 === 0 ? mat0 : mat1));
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
            this._routeIndex     = 0;
            this._routePathDrawn = false;
            this._brushActive    = false;   // stato spazzole durante il percorso
        }

        // Aggiorna _brushActive in base al segmento corrente e logga i cambi
        _updateBrushState() {
            const segIdx      = this._routeIndex - 1;
            const shouldBrush = (segIdx >= 0 && segIdx < ROUTE_BRUSH_ACTIVE.length)
                ? ROUTE_BRUSH_ACTIVE[segIdx]
                : false;
            if (shouldBrush !== this._brushActive) {
                this._brushActive = shouldBrush;
                log.timeout(shouldBrush
                    ? "🧹 Brush ON  — segment " + segIdx
                    : "⏸ Brush OFF — segment " + segIdx);
            }
        }

        setup(context) {
            this.initializeRenderer(context);
            this.initializeCamera(context);
            this.initializeScene(context);
        }

        render(context) {
            this.updateCamera(context);
            this.updateLights(context);

            if (!this._routePathDrawn) {
                this._routePathDrawn = true;
                this._drawRoutePath();
            }

            if (this.moving && this.point != null && this.objectWrapper != null) {
                this._followRoute();
            }

            this.wheelsFront.forEach(w => { w.rotation.x += WHEEL_SPEED; });
            this.wheelsRear.forEach(w  => { w.rotation.x += WHEEL_SPEED; });

            // Durante il Play: usa _brushActive dall'array di rotta.
            // A riposo:        usa il checkbox (che è abilitato).
            const chk     = document.getElementById("chkPulisci");
            const brushOn = this.moving
                ? this._brushActive
                : (chk && chk.checked);
            if (brushOn) {
                if (this.brushL) this.brushL.rotation.y += BRUSH_SPEED;
                if (this.brushR) this.brushR.rotation.y -= BRUSH_SPEED;
            }

            this.renderer.resetGLState();
            this.renderer.render(this.scene, this.camera);
            context.resetWebGLState();
            externalRenderers.requestRender(view);
        }

        // Avanza il modello lungo ROUTE_PATH_WGS84
        _followRoute() {
            if (this._routeIndex >= ROUTE_PATH_WGS84.length) {
                // Percorso terminato
                const [lastLng, lastLat] = ROUTE_PATH_WGS84[ROUTE_PATH_WGS84.length - 1];
                const wkid = this.point.spatialReference && this.point.spatialReference.wkid;
                const endPt = this.point.clone();
                if (wkid === 102100 || wkid === 3857) {
                    const [mx, my] = webMercatorUtils.lngLatToXY(lastLng, lastLat);
                    endPt.x = mx; endPt.y = my;
                } else {
                    endPt.x = lastLng; endPt.y = lastLat;
                }
                this.point = endPt;
                this.applyWrapperTransformAt(this.point);
                this.moving = false;
                // Riabilita checkbox e logga fine
                const chk = document.getElementById("chkPulisci");
                if (chk) chk.disabled = false;
                const btn = document.getElementById("btnMoveForward");
                if (btn) btn.textContent = "▶ Play";
                log.timeout("Route completed");
                return;
            }

            // Aggiorna stato spazzole per il segmento corrente
            this._updateBrushState();

            const [curLng, curLat] = pointToWGS84(this.point);
            const [tgtLng, tgtLat] = ROUTE_PATH_WGS84[this._routeIndex];

            const dist    = haversineDistance(curLng, curLat, tgtLng, tgtLat);
            const bearing = geoBearing(curLng, curLat, tgtLng, tgtLat);

            this.rotation = bearingToRotation(bearing);
            applyLocalOrientation(this.object, this.rotation);
            this.objectWrapper.updateMatrixWorld(true);

            if (dist <= MOVE_STEP_M) {
                this.point = movePoint(this.point, bearing, dist);
                this._routeIndex++;
                this._updateBrushState();   // aggiorna subito al nuovo segmento
            } else {
                this.point = movePoint(this.point, bearing, MOVE_STEP_M);
            }

            this.applyWrapperTransformAt(this.point);
        }

        add(location) {
            if (this.object == null) {
                this.point = location;
                this.addColladaModel(this.point);
                log.timeout("Added sweeper");
            } else {
                this.placed = true;
                this.point  = location;
                this.applyWrapperTransformAt(location, MODEL_GROUND_OFFSET_PLACE);
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

            const chk = document.getElementById("chkClean");

            if (this.moving) {
                // Disabilita checkbox: durante il Play le spazzole sono gestite dall'array
                if (chk) chk.disabled = true;

                this._routeIndex = 1;
                this._brushActive = false;      // verrà aggiornato subito sotto
                this._updateBrushState();       // log immediato del segmento 0

                const [lng0, lat0] = ROUTE_PATH_WGS84[0];
                const wkid = this.point.spatialReference && this.point.spatialReference.wkid;
                const startPt = this.point.clone();
                if (wkid === 102100 || wkid === 3857) {
                    const [mx, my] = webMercatorUtils.lngLatToXY(lng0, lat0);
                    startPt.x = mx; startPt.y = my;
                } else {
                    startPt.x = lng0; startPt.y = lat0;
                }
                this.point = startPt;

                view.goTo({ center: [lng0, lat0], zoom: 18, tilt: 65 });

                const [lng1, lat1] = ROUTE_PATH_WGS84[1];
                this.rotation = bearingToRotation(geoBearing(lng0, lat0, lng1, lat1));
                applyLocalOrientation(this.object, this.rotation);
                this.objectWrapper.updateMatrixWorld(true);
                this.applyWrapperTransformAt(this.point);

            } else {
                // Stop: riabilita checkbox
                if (chk) chk.disabled = false;
                log.timeout("Stop");
            }

            const btn = document.getElementById("btnMoveForward");
            if (btn) btn.textContent = this.moving ? "⏹ Stop" : "▶ Play";
        }

        addColladaModel(location) {
            const loader = new THREE.ColladaLoader();
            loader.load("./app/data/sweeper.dae", (collada) => {
                this.object = collada.scene;
                this.objectWrapper = new THREE.Group();
                this.objectWrapper.add(this.object);
                applyLocalOrientation(this.object, this.rotation);
                this.applyWrapperTransformAt(location, MODEL_GROUND_OFFSET_PLACE);
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

                const brushRadius = size.x * 6.50;
                const groundY     = bbox.min.y;
                const frontZ      = wFL.z + brushRadius * 2.5;
                const outset      = brushRadius * 3.50;

                this.brushL = createBrush(brushRadius, 8);
                this.brushL.position.set(bbox.min.x - outset, groundY, frontZ);
                this.object.add(this.brushL);

                this.brushR = createBrush(brushRadius, 8);
                this.brushR.position.set(bbox.max.x + outset, groundY, frontZ);
                this.object.add(this.brushR);

                externalRenderers.requestRender(view);
            });
        }

        update(renderAt) {
            if (this.placed) return;
            if (this.objectWrapper != null) {
                const pt = view.toMap(new ScreenPoint(renderAt.x, renderAt.y));
                if (pt != null) {
                    this.point = pt;
                    this.applyWrapperTransformAt(this.point, MODEL_GROUND_OFFSET_PLACE);
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

        applyWrapperTransformAt(location, groundOffset = MODEL_GROUND_OFFSET_ROUTE) {
            const transform = new THREE.Matrix4();
            const z = (location.z !== undefined && !isNaN(location.z))
                ? location.z + groundOffset
                : groundOffset;
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

        // Disegna ROUTE_PATH_WGS84 come linea sottile non invasiva
        _drawRoutePath() {
            const points = [];
            for (const [lng, lat] of ROUTE_PATH_WGS84) {
                const [mx, my] = webMercatorUtils.lngLatToXY(lng, lat);
                const mat = new THREE.Matrix4();
                externalRenderers.renderCoordinateTransformAt(view, [mx, my, 2], view.spatialReference, mat.elements);
                const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
                mat.decompose(pos, quat, sc);
                points.push(pos);
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            this.scene.add(new THREE.Line(geometry,
                new THREE.LineBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.55, depthWrite: false })));
            this.scene.add(new THREE.Points(geometry,
                new THREE.PointsMaterial({ color: 0x29b6f6, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
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
            if (btn) btn.addEventListener("click", () => renderer.toggleMoving());

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