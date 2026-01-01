// Viewer 3D avec Three.js
class Viewer3D {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.stlMesh = null;
        this.tableMesh = null;
        this.currentView = 'perspective';
        this.sectionPlane = null;
        
        this.init();
        this.animate();
    }

    init() {
        // Scène
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f3460);
        // Pas de brouillard pour éviter les problèmes de visibilité

        // Caméra
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        this.camera.position.set(80, 60, 120);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Contrôles
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 10;
        this.controls.maxDistance = 400;
        this.controls.maxPolarAngle = Math.PI / 2;

        // Lumières
        this.setupLights();

        // Grille et axes
        this.setupGrid();

        // Table
        this.createTable();

        // Plan de coupe (invisible au départ)
        this.createSectionPlane();
        
        // Raycaster pour la sélection du point d'accrochage
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.hangingPoint = null;
        this.hangingPointMarker = null;
        this.isSelectingHangingPoint = false;
        
        // Écouteur de clics
        this.setupClickListener();
    }

    setupLights() {
        // Lumière ambiante
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        // Lumière directionnelle principale
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(80, 120, 80);
        mainLight.castShadow = true;
        mainLight.shadow.camera.left = -150;
        mainLight.shadow.camera.right = 150;
        mainLight.shadow.camera.top = 150;
        mainLight.shadow.camera.bottom = -150;
        mainLight.shadow.camera.near = 0.1;
        mainLight.shadow.camera.far = 500;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        this.scene.add(mainLight);

        // Lumière de remplissage
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight.position.set(-80, 60, -80);
        this.scene.add(fillLight);

        // Lumière arrière
        const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
        backLight.position.set(0, 60, -120);
        this.scene.add(backLight);

        // Lumière ponctuelle pour accentuation
        const spotLight = new THREE.SpotLight(0xffffff, 0.6);
        spotLight.position.set(0, 150, 0);
        spotLight.angle = Math.PI / 4;
        spotLight.penumbra = 0.1;
        spotLight.decay = 2;
        spotLight.distance = 300;
        this.scene.add(spotLight);
    }

    setupGrid() {
        // Grille de sol
        const gridHelper = new THREE.GridHelper(300, 60, 0x4CAF50, 0x2d3561);
        gridHelper.position.y = -0.1;
        this.scene.add(gridHelper);

        // Axes de référence
        const axesHelper = new THREE.AxesHelper(50);
        this.scene.add(axesHelper);
    }

    createTable(thickness = 2.1) {
        // Supprimer l'ancienne table si elle existe
        if (this.tableMesh) {
            this.scene.remove(this.tableMesh);
            this.tableMesh.geometry.dispose();
            this.tableMesh.material.dispose();
        }
        
        // Supprimer les anciens marqueurs
        const oldMarkers = this.scene.children.filter(child => child.userData.isTableMarker);
        oldMarkers.forEach(marker => this.scene.remove(marker));
        
        // Plateau de table HORIZONTAL
        // Dimensions : 150cm x 80cm
        const tableGeometry = new THREE.BoxGeometry(150, thickness, 80);
        const tableMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513,
            roughness: 0.8,
            metalness: 0.1
        });
        
        this.tableMesh = new THREE.Mesh(tableGeometry, tableMaterial);
        
        // IMPORTANT : Positionner pour que le coin inférieur droit soit à (0, 0, 0)
        // La table fait 150cm (X) x 80cm (Z)
        // Donc on décale de -75 en X et +40 en Z pour que le coin soit au centre
        this.tableMesh.position.set(-75, thickness / 2, 40);
        
        this.tableMesh.receiveShadow = true;
        this.tableMesh.castShadow = true;
        this.scene.add(this.tableMesh);

        // Contours de la table pour meilleure visibilité
        const edges = new THREE.EdgesGeometry(tableGeometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4CAF50, linewidth: 2 });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        this.tableMesh.add(wireframe);

        // Ajouter des repères visuels
        this.addTableEdgeMarkers();
        
        // Stocker l'épaisseur
        this.tableThickness = thickness;
    }
    
    addTableEdgeMarkers() {
        // Créer des pieds de table (cylindres) aux 4 coins SOUS la table
        const footGeometry = new THREE.CylinderGeometry(2, 2, 15, 16);
        const footMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513, // Couleur bois comme la table
            roughness: 0.8,
            metalness: 0.1
        });
        
        // Coins par rapport au centre de la scène (0, 0, 0 = coin inférieur droit)
        // La table est à Y = 1.05 (centre), donc de Y = 0 à Y = 2.1
        // Les pieds doivent être SOUS, donc centrés à Y = -7.5 (15/2 de hauteur sous Y=0)
        const corners = [
            { x: -150, z: 0 },   // Coin inférieur gauche
            { x: -150, z: 80 },  // Coin supérieur gauche
            { x: 0, z: 80 },     // Coin supérieur droit
            { x: 0, z: 0 }       // Coin inférieur droit (au centre 0,0,0)
        ];
        
        corners.forEach(corner => {
            const foot = new THREE.Mesh(footGeometry, footMaterial);
            foot.position.set(corner.x, -7.5, corner.z); // SOUS la table
            foot.userData.isTableMarker = true;
            this.scene.add(foot);
        });
        
        // Ajouter une ligne lumineuse sur le bord inférieur (zone d'insertion)
        const edgePoints = [
            new THREE.Vector3(-150, 2.1, 0),
            new THREE.Vector3(0, 2.1, 0)
        ];
        const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
        const edgeMaterial = new THREE.LineBasicMaterial({ 
            color: 0x00FF00, 
            linewidth: 3,
            transparent: true,
            opacity: 0.8
        });
        const edgeLine = new THREE.Line(edgeGeometry, edgeMaterial);
        edgeLine.userData.isTableMarker = true;
        this.scene.add(edgeLine);
    }

    addThicknessIndicator() {
        // Texte 3D simulé avec sprite pour indiquer l'épaisseur
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 128;
        
        context.fillStyle = '#4CAF50';
        context.font = 'Bold 40px Arial';
        context.textAlign = 'center';
        context.fillText('2.1 cm', 128, 80);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(10, 1, 0); // Sur le bord droit de la table
        sprite.scale.set(20, 10, 1);
        this.scene.add(sprite);
    }

    createSectionPlane() {
        // Plan de coupe pour la vue en coupe
        const planeGeometry = new THREE.PlaneGeometry(200, 200);
        const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.1,
            visible: false
        });
        
        this.sectionPlane = new THREE.Mesh(planeGeometry, planeMaterial);
        this.sectionPlane.position.set(0, 0, 0);
        this.scene.add(this.sectionPlane);
    }
    
    setupClickListener() {
        this.renderer.domElement.addEventListener('click', (event) => {
            if (!this.isSelectingHangingPoint || !this.stlMesh) return;
            
            // Calculer les coordonnées normalisées de la souris
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            
            // Mettre à jour le raycaster
            this.raycaster.setFromCamera(this.mouse, this.camera);
            
            // Vérifier l'intersection avec le mesh STL
            const intersects = this.raycaster.intersectObject(this.stlMesh);
            
            if (intersects.length > 0) {
                const point = intersects[0].point;
                this.setHangingPoint(point);
                this.isSelectingHangingPoint = false;
                
                // Changer le curseur
                this.renderer.domElement.style.cursor = 'default';
                
                // Notifier l'application
                if (window.app) {
                    window.app.onHangingPointSelected(point);
                }
            }
        });
        
        // Changer le curseur quand on survole le mesh en mode sélection
        this.renderer.domElement.addEventListener('mousemove', (event) => {
            if (!this.isSelectingHangingPoint || !this.stlMesh) return;
            
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(this.stlMesh);
            
            this.renderer.domElement.style.cursor = intersects.length > 0 ? 'crosshair' : 'default';
        });
    }
    
    enableHangingPointSelection() {
        this.isSelectingHangingPoint = true;
        this.renderer.domElement.style.cursor = 'crosshair';
    }
    
    disableHangingPointSelection() {
        this.isSelectingHangingPoint = false;
        this.renderer.domElement.style.cursor = 'default';
    }
    
    setHangingPoint(point) {
        this.hangingPoint = point.clone();
        
        // Supprimer l'ancien marqueur 3D
        if (this.hangingPointMarker) {
            this.scene.remove(this.hangingPointMarker);
            this.hangingPointMarker = null;
        }
        
        // Créer un overlay 2D HTML
        if (!this.targetOverlay) {
            this.targetOverlay = document.createElement('div');
            this.targetOverlay.className = 'hanging-point-target';
            this.targetOverlay.innerHTML = `
                <svg width="40" height="40" viewBox="-20 -20 40 40">
                    <circle cx="0" cy="0" r="18" fill="none" stroke="#FF0000" stroke-width="2"/>
                    <line x1="-20" y1="0" x2="20" y2="0" stroke="#FF0000" stroke-width="2"/>
                    <line x1="0" y1="-20" x2="0" y2="20" stroke="#FF0000" stroke-width="2"/>
                    <circle cx="0" cy="0" r="4" fill="#FFFFFF" stroke="#FF0000" stroke-width="1"/>
                </svg>
            `;
            this.container.appendChild(this.targetOverlay);
        }
        
        this.hangingPoint2D = point.clone();
        this.updateTargetPosition();
    }
    
    updateTargetPosition() {
        if (!this.hangingPoint2D || !this.targetOverlay) return;
        
        // Projeter le point 3D en 2D
        const vector = this.hangingPoint2D.clone();
        vector.project(this.camera);
        
        // Convertir en coordonnées écran
        const x = (vector.x * 0.5 + 0.5) * this.container.clientWidth;
        const y = (-(vector.y * 0.5) + 0.5) * this.container.clientHeight;
        
        this.targetOverlay.style.left = x + 'px';
        this.targetOverlay.style.top = y + 'px';
    }
    
    clearHangingPoint() {
        this.hangingPoint = null;
        this.hangingPoint2D = null;
        
        if (this.hangingPointMarker) {
            this.scene.remove(this.hangingPointMarker);
            this.hangingPointMarker = null;
        }
        
        if (this.targetOverlay) {
            this.targetOverlay.remove();
            this.targetOverlay = null;
        }
    }

    loadSTL(geometry) {
        // Supprimer l'ancien mesh si existant
        if (this.stlMesh) {
            this.scene.remove(this.stlMesh);
            this.stlMesh.geometry.dispose();
            this.stlMesh.material.dispose();
        }

        // Centrer la géométrie
        geometry.center();
        geometry.computeVertexNormals();

        // Créer le matériau
        const material = new THREE.MeshStandardMaterial({
            color: 0xFFC107,
            roughness: 0.5,
            metalness: 0.3,
            flatShading: false,
            side: THREE.DoubleSide
        });

        // Créer le mesh
        this.stlMesh = new THREE.Mesh(geometry, material);
        this.stlMesh.castShadow = true;
        this.stlMesh.receiveShadow = true;
        
        // IMPORTANT : Diviser l'échelle par 10 pour correspondre à la table
        // Les fichiers STL sont souvent en mm, on les met à l'échelle cm
        this.stlMesh.scale.set(0.1, 0.1, 0.1);
        
        // Stocker la géométrie originale pour les analyses
        this.stlMesh.userData.originalGeometry = geometry.clone();
        
        this.scene.add(this.stlMesh);

        // POSITIONNER par défaut à X=6, Y=0, Z=10
        this.stlMesh.geometry.computeBoundingBox();
        const bbox = new THREE.Box3().setFromObject(this.stlMesh);
        const size = bbox.getSize(new THREE.Vector3());
        
        // Position par défaut demandée
        const xPos = 6;
        const yPos = 2.1 - size.y * 0.2; // Ajuster Y pour insertion dans la table
        const zPos = 10;
        
        this.stlMesh.position.set(xPos, yPos, zPos);

        // Vue adaptée à l'objet automatiquement
        this.fitCameraToObject();
    }

    fitCameraToObjectAndTable() {
        if (!this.stlMesh) return;

        // On veut voir à la fois l'objet ET le coin de la table au centre (0,0,0)
        const objectBox = new THREE.Box3().setFromObject(this.stlMesh);
        
        // Étendre la bbox pour inclure le coin de la table et une partie visible
        const viewBox = objectBox.clone();
        viewBox.expandByPoint(new THREE.Vector3(0, 0, 0)); // Coin au centre
        viewBox.expandByPoint(new THREE.Vector3(-50, 2, 30)); // Partie de la table
        
        const center = viewBox.getCenter(new THREE.Vector3());
        const size = viewBox.getSize(new THREE.Vector3());
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 2.2; // Marge pour bien voir

        // Positionner la caméra pour avoir une vue en perspective du coin
        this.camera.position.set(
            center.x + cameraZ * 0.7,
            center.y + cameraZ * 0.6,
            center.z + cameraZ * 0.9
        );
        
        this.controls.target.copy(center);
        this.controls.update();
    }

    fitCameraToObject() {
        if (!this.stlMesh) return;

        const box = new THREE.Box3().setFromObject(this.stlMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 2; // Ajouter de la marge

        this.camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.7, center.z + cameraZ);
        this.controls.target.copy(center);
        this.controls.update();
    }

    autoPositionOnTable() {
        if (!this.stlMesh) return { x: 0, y: 0, z: 0 };

        // Calculer la boîte englobante
        const box = new THREE.Box3().setFromObject(this.stlMesh);
        const size = box.getSize(new THREE.Vector3());

        // Position par défaut
        const tableThickness = 2.1;
        
        const x = 6; // Position par défaut
        const z = 10; // Position par défaut
        const y = tableThickness - size.y * 0.2; // 20% inséré dans la table

        this.stlMesh.position.set(x, y, z);

        return { x, y, z };
    }

    setView(view) {
        if (!this.stlMesh) return;

        const box = new THREE.Box3().setFromObject(this.stlMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const distance = maxDim * 2.5;

        this.currentView = view;

        // Cacher/afficher le plan de coupe
        if (this.sectionPlane) {
            this.sectionPlane.material.visible = (view === 'section');
            if (view === 'section') {
                this.sectionPlane.position.copy(center);
                this.sectionPlane.rotation.set(Math.PI / 2, 0, 0);
            }
        }

        switch (view) {
            case 'perspective':
                this.camera.position.set(
                    center.x + distance * 0.7,
                    center.y + distance * 0.7,
                    center.z + distance
                );
                break;
            
            case 'front':
                this.camera.position.set(center.x, center.y, center.z + distance);
                break;
            
            case 'side':
                this.camera.position.set(center.x + distance, center.y, center.z);
                break;
            
            case 'top':
                this.camera.position.set(center.x, center.y + distance, center.z);
                break;
            
            case 'section':
                // Vue en coupe - caméra de côté avec plan de coupe visible
                this.camera.position.set(center.x + distance, center.y, center.z);
                break;
        }

        this.controls.target.copy(center);
        this.controls.update();
    }

    visualizeStressWithTexture(simulationResult) {
        if (!this.stlMesh) {
            console.error('❌ Pas de mesh STL');
            return;
        }

        console.log('🎨 === VISUALISATION ===');
        this.clearVisualization();

        const stressMap = simulationResult.stressAnalysis.stressMap;
        const maxStress = simulationResult.stressAnalysis.maxStress;
        
        if (!stressMap || stressMap.length === 0) {
            console.error('❌ Pas de données de contrainte');
            return;
        }

        try {
            // Nouveau matériau avec vertex colors
            this.stlMesh.material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide
            });

            const geometry = this.stlMesh.geometry;
            const positions = geometry.attributes.position;
            const colors = new Float32Array(positions.count * 3);
            
            // Créer un index par vertex index (le plus efficace)
            const stressByIndex = new Map();
            stressMap.forEach(sm => {
                if (sm.vertex && sm.vertex.index !== undefined) {
                    stressByIndex.set(sm.vertex.index, sm);
                }
            });
            
            // Si on a un mapping par index, l'utiliser directement
            const useIndexMapping = stressByIndex.size > 0;
            console.log('📊 Mode de mapping:', useIndexMapping ? 'par index' : 'spatial');
            console.log('📊 Score fragilité max:', maxStress.toFixed(2));

            // Colorier chaque vertex
            for (let i = 0; i < positions.count; i++) {
                let stressData;
                
                if (useIndexMapping) {
                    // Mapping direct par index
                    stressData = stressByIndex.get(i);
                } else {
                    // Fallback : recherche spatiale
                    const worldPos = new THREE.Vector3(
                        positions.getX(i),
                        positions.getY(i),
                        positions.getZ(i)
                    );
                    worldPos.multiplyScalar(0.1);
                    worldPos.applyEuler(this.stlMesh.rotation);
                    worldPos.add(this.stlMesh.position);
                    
                    stressData = this.findNearestStress(worldPos, stressMap);
                }
                
                // Calculer la couleur
                let color;
                if (!stressData) {
                    color = new THREE.Color(0.5, 0.5, 0.5); // Gris si pas de données
                } else if (stressData.inAnchorZone) {
                    color = new THREE.Color(0.1, 0.2, 0.6); // Bleu foncé pour ancrage
                } else {
                    // Normaliser le score de fragilité
                    let ratio = stressData.stress / maxStress;
                    ratio = Math.max(0, Math.min(1, ratio));
                    
                    // Appliquer une courbe pour accentuer les zones critiques
                    ratio = Math.pow(ratio, 0.7);
                    
                    color = this.getStressColor(ratio);
                }

                colors[i * 3] = color.r;
                colors[i * 3 + 1] = color.g;
                colors[i * 3 + 2] = color.b;
            }

            // Appliquer les couleurs
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.attributes.color.needsUpdate = true;
            this.stlMesh.material.needsUpdate = true;

            // Légende
            this.addSimpleLegend(maxStress, simulationResult.failureAnalysis);
            
            console.log('✅ Visualisation terminée');
            console.log('✅ Visualisation terminée');
            
        } catch (error) {
            console.error('❌ Erreur visualisation:', error);
        }
    }
    
    /**
     * Trouver la contrainte la plus proche
     */
    findNearestStress(pos, stressMap) {
        let nearest = null;
        let minDist = Infinity;
        
        // Échantillonner pour performance
        const step = Math.max(1, Math.floor(stressMap.length / 1000));
        
        for (let i = 0; i < stressMap.length; i += step) {
            const sm = stressMap[i];
            const dist = pos.distanceTo(sm.vertex.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = sm;
            }
        }
        
        // Si trouvé un proche, chercher plus précisément autour
        if (nearest && minDist < 5) {
            for (const sm of stressMap) {
                const dist = pos.distanceTo(sm.vertex.position);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = sm;
                }
                if (dist < 0.5) break; // Assez proche
            }
        }
        
        return nearest;
    }
    
    /**
     * Mettre à jour les couleurs du modèle 3D basé sur la simulation 2D
     */
    updateDeformationColors(stressData) {
        if (!this.stlMesh || !stressData || !stressData.map) return;
        
        const geometry = this.stlMesh.geometry;
        const positions = geometry.attributes.position;
        const colors = geometry.attributes.color;
        
        if (!colors) return;
        
        const stressMap = stressData.map;
        const maxStress = stressData.maxStress || 1;
        
        for (let i = 0; i < positions.count; i++) {
            // Position en coordonnées monde
            const worldPos = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            worldPos.multiplyScalar(0.1);
            worldPos.applyEuler(this.stlMesh.rotation);
            worldPos.add(this.stlMesh.position);
            
            // Chercher le stress à cette hauteur Y
            const yKey = Math.round(worldPos.y * 10) / 10;
            let stressInfo = stressMap.get(yKey);
            
            // Si pas trouvé, chercher le plus proche
            if (!stressInfo) {
                let closestY = null;
                let minDist = Infinity;
                stressMap.forEach((value, key) => {
                    const dist = Math.abs(key - worldPos.y);
                    if (dist < minDist) {
                        minDist = dist;
                        closestY = key;
                    }
                });
                if (closestY !== null) {
                    stressInfo = stressMap.get(closestY);
                }
            }
            
            // Calculer la couleur
            let color;
            if (stressInfo) {
                const ratio = Math.min(1, stressInfo.ratio);
                color = this.getStressColor(ratio);
            } else {
                color = new THREE.Color(0.3, 0.3, 0.8); // Bleu par défaut
            }
            
            colors.setXYZ(i, color.r, color.g, color.b);
        }
        
        colors.needsUpdate = true;
    }
    
    /**
     * Légende verticale
     */
    addSimpleLegend(maxStress, failureAnalysis) {
        if (this.stressLegend) {
            this.stressLegend.remove();
        }
        
        const safety = failureAnalysis.safety;
        let statusColor, statusText;
        
        if (safety === 'safe') {
            statusColor = '#4CAF50';
            statusText = '✅ SOLIDE';
        } else if (safety === 'warning') {
            statusColor = '#FF9800';
            statusText = '⚠️ FRAGILE';
        } else {
            statusColor = '#f44336';
            statusText = '❌ RISQUE';
        }
        
        const legend = document.createElement('div');
        legend.className = 'stress-legend';
        legend.innerHTML = `
            <div style="color: ${statusColor}; font-weight: bold; font-size: 13px; margin-bottom: 8px; text-align: center;">
                ${statusText}
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div class="legend-gradient-vertical"></div>
                <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100px; font-size: 10px;">
                    <span style="color: #f44336;">Fragile</span>
                    <span style="color: #2196F3;">Solide</span>
                </div>
            </div>
        `;
        
        this.container.appendChild(legend);
        this.stressLegend = legend;
    }
    
    /**
     * Ancienne visualisation pour compatibilité
     */
    visualizeStressLegacy(simulationResult) {
        if (!this.stlMesh) {
            console.error('❌ Pas de mesh STL disponible');
            return;
        }

        console.log('🎨 === DÉBUT VISUALISATION CONTRAINTES (LEGACY) ===');

        // Nettoyer les anciennes visualisations
        this.clearVisualization();

        let geometry = this.stlMesh.geometry;
        const stressMap = simulationResult.stressAnalysis.stressMap;
        
        console.log('📊 Vertices initiaux:', geometry.attributes.position.count);
        console.log('📊 Sections de contrainte:', stressMap.length);
        
        // PROTECTION : Vérifier qu'on a des données
        if (!stressMap || stressMap.length === 0) {
            console.error('❌ Aucune donnée de contrainte disponible');
            return;
        }

        try {
            // CRITIQUE : CRÉER UN NOUVEAU MATÉRIAU AVANT TOUT
            console.log('🎨 Création nouveau matériau avec vertexColors activé');
            this.stlMesh.material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness: 0.7,
                metalness: 0.2,
                side: THREE.DoubleSide
            });

            // ÉTAPE 1 : Subdiviser UNIQUEMENT si pas trop de vertices
            const initialVertexCount = geometry.attributes.position.count;
            
            if (initialVertexCount > 10000) {
                console.warn('⚠️ Mesh déjà dense (' + initialVertexCount + ' vertices), pas de subdivision');
            } else {
                console.log('📊 Vertices avant subdivision:', initialVertexCount);
                
                // Conversion en géométrie non-indexée
                if (geometry.index !== null) {
                    geometry = geometry.toNonIndexed();
                }
                
                // Subdivision adaptative
                let subdivisions = 3; // Réduire à 3 pour être plus rapide
                if (initialVertexCount > 5000) subdivisions = 2;
                else if (initialVertexCount > 2000) subdivisions = 2;
                
                console.log('🔄 Subdivision niveau:', subdivisions);
                
                try {
                    geometry = this.subdivideGeometry(geometry, subdivisions);
                    console.log('📊 Vertices après subdivision:', geometry.attributes.position.count);
                    
                    // Remplacer la géométrie
                    this.stlMesh.geometry.dispose();
                    this.stlMesh.geometry = geometry;
                } catch (subdivError) {
                    console.error('❌ Erreur subdivision:', subdivError);
                    console.log('➡️ Utilisation du mesh original');
                    geometry = this.stlMesh.geometry;
                }
            }

            const positions = geometry.attributes.position;
            
            // ÉTAPE 2 : Normalisation avec ÉCHELLE FIXE
            // Le PLA casse à 50 MPa (yield strength)
            // On utilise une échelle fixe de 0 à 50 MPa pour que tous les supports soient comparables
            const minStress = 0;
            const maxStress = 50; // MPa - limite du PLA
            
            // Trouver la contrainte max réelle pour les logs
            let actualMaxStress = 0;
            stressMap.forEach(sm => {
                if (!sm.inAnchorZone && !isNaN(sm.stress) && isFinite(sm.stress)) {
                    actualMaxStress = Math.max(actualMaxStress, sm.stress);
                }
            });

            console.log('📊 Échelle FIXE - Min: 0 MPa, Max: 50 MPa (limite PLA)');
            console.log('📊 Contrainte max réelle:', actualMaxStress.toFixed(3), 'MPa');

            // ÉTAPE 3 : Application des couleurs
            const colors = new Float32Array(positions.count * 3);
            let colorsApplied = 0;

            for (let i = 0; i < positions.count; i++) {
                try {
                    const vertex = new THREE.Vector3(
                        positions.getX(i),
                        positions.getY(i),
                        positions.getZ(i)
                    );

                    // BUG FIX CRITIQUE : Utiliser this.stlMesh au lieu de this.mesh !
                    const vertexWorld = vertex.clone();
                    vertexWorld.multiplyScalar(0.1);
                    vertexWorld.applyEuler(this.stlMesh.rotation);
                    vertexWorld.add(this.stlMesh.position);

                    // Trouver sections proches
                    const closestSections = stressMap
                        .map(sm => ({
                            stress: sm.stress,
                            inAnchorZone: sm.inAnchorZone,
                            distance: vertexWorld.distanceTo(sm.section.center)
                        }))
                        .sort((a, b) => a.distance - b.distance)
                        .slice(0, 5);

                    // Interpolation
                    let totalWeight = 0;
                    let weightedStress = 0;

                    closestSections.forEach(cs => {
                        const weight = cs.distance > 0.001 ? 1 / Math.pow(cs.distance, 2) : 100000;
                        totalWeight += weight;
                        weightedStress += cs.stress * weight;
                    });

                    const finalStress = totalWeight > 0 ? weightedStress / totalWeight : 0;

                    // Normaliser
                    let ratio = 0;
                    if (finalStress < minStress * 0.5) {
                        ratio = 0.0;
                    } else {
                        ratio = (finalStress - minStress) / (maxStress - minStress);
                        ratio = Math.max(0, Math.min(1, Math.pow(ratio, 0.7)));
                    }

                    // Obtenir couleur
                    const color = this.getStressColor(ratio);

                    // Stocker
                    colors[i * 3] = color.r;
                    colors[i * 3 + 1] = color.g;
                    colors[i * 3 + 2] = color.b;
                    colorsApplied++;
                    
                } catch (vertexError) {
                    colors[i * 3] = 0.5;
                    colors[i * 3 + 1] = 0.5;
                    colors[i * 3 + 2] = 0.5;
                }
            }

            console.log('✅ Couleurs appliquées:', colorsApplied, '/', positions.count);

            // ÉTAPE 4 : Appliquer les vertex colors
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.computeVertexNormals();
            
            // Forcer la mise à jour
            geometry.attributes.color.needsUpdate = true;
            this.stlMesh.material.needsUpdate = true;

            console.log('✅ Visualisation contraintes terminée');
            console.log('🎨 === FIN VISUALISATION ===');

            // Ajouter la légende
            this.addStressLegend(simulationResult.stressAnalysis);
            
        } catch (error) {
            console.error('❌ ERREUR VISUALISATION:', error);
            console.error('Stack:', error.stack);
        }
    }

    /**
     * Subdiviser une géométrie (algorithme simple de midpoint subdivision)
     */
    subdivideGeometry(geometry, levels) {
        for (let level = 0; level < levels; level++) {
            geometry = this.subdivideOnce(geometry);
        }
        return geometry;
    }

    /**
     * Subdivision simple : chaque triangle devient 4 triangles
     */
    subdivideOnce(geometry) {
        const positions = geometry.attributes.position.array;
        const newPositions = [];
        
        // Pour chaque triangle (3 vertices)
        for (let i = 0; i < positions.length; i += 9) {
            // Les 3 vertices du triangle
            const v0 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
            const v1 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
            const v2 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);
            
            // Calculer les points milieux
            const m01 = new THREE.Vector3().addVectors(v0, v1).multiplyScalar(0.5);
            const m12 = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
            const m20 = new THREE.Vector3().addVectors(v2, v0).multiplyScalar(0.5);
            
            // Créer 4 nouveaux triangles
            // Triangle 1 : v0, m01, m20
            newPositions.push(v0.x, v0.y, v0.z);
            newPositions.push(m01.x, m01.y, m01.z);
            newPositions.push(m20.x, m20.y, m20.z);
            
            // Triangle 2 : m01, v1, m12
            newPositions.push(m01.x, m01.y, m01.z);
            newPositions.push(v1.x, v1.y, v1.z);
            newPositions.push(m12.x, m12.y, m12.z);
            
            // Triangle 3 : m20, m12, v2
            newPositions.push(m20.x, m20.y, m20.z);
            newPositions.push(m12.x, m12.y, m12.z);
            newPositions.push(v2.x, v2.y, v2.z);
            
            // Triangle 4 : m01, m12, m20
            newPositions.push(m01.x, m01.y, m01.z);
            newPositions.push(m12.x, m12.y, m12.z);
            newPositions.push(m20.x, m20.y, m20.z);
        }
        
        // Créer nouvelle géométrie
        const newGeometry = new THREE.BufferGeometry();
        newGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
        
        return newGeometry;
    }

    visualizeStress(simulationResult) {
        if (!this.stlMesh) return;

        // Nettoyer les anciennes visualisations
        this.clearVisualization();

        // Appliquer uniquement la carte de chaleur sur le mesh
        this.applyStressColorsSmooth(simulationResult.visualization, simulationResult.stressAnalysis);
        
        // Ajouter la légende de couleurs
        this.addStressLegend(simulationResult.stressAnalysis);
    }
    
    addStressLegend(stressAnalysis) {
        // Supprimer l'ancienne légende si elle existe
        if (this.stressLegend) {
            this.stressLegend.remove();
        }
        
        // Créer la légende HTML
        const legend = document.createElement('div');
        legend.className = 'stress-legend';
        legend.innerHTML = `
            <div class="legend-title">Contraintes (MPa)</div>
            <div class="legend-gradient"></div>
            <div class="legend-labels">
                <span>${stressAnalysis.maxStress.toFixed(1)}</span>
                <span>${(stressAnalysis.maxStress * 0.5).toFixed(1)}</span>
                <span>0.0</span>
            </div>
            <div class="legend-colors">
                <div class="color-label"><span class="color-box" style="background: rgb(255,0,0)"></span> Critique</div>
                <div class="color-label"><span class="color-box" style="background: rgb(255,255,0)"></span> Élevé</div>
                <div class="color-label"><span class="color-box" style="background: rgb(0,255,0)"></span> Moyen</div>
                <div class="color-label"><span class="color-box" style="background: rgb(0,255,255)"></span> Faible</div>
                <div class="color-label"><span class="color-box" style="background: rgb(0,0,255)"></span> Minimal</div>
            </div>
        `;
        
        this.container.appendChild(legend);
        this.stressLegend = legend;
    }

    clearVisualization() {
        // Supprimer tous les marqueurs de visualisation
        const markers = this.scene.children.filter(child => 
            child.userData.isVisualization || child.userData.isMarker || child.userData.isForceArrow
        );
        markers.forEach(marker => this.scene.remove(marker));

        // Réinitialiser les couleurs du mesh
        if (this.stlMesh && this.stlMesh.geometry.attributes.color) {
            this.stlMesh.geometry.deleteAttribute('color');
            this.stlMesh.material.vertexColors = false;
            this.stlMesh.material.needsUpdate = true;
        }
        
        // Supprimer la légende
        if (this.stressLegend) {
            this.stressLegend.remove();
            this.stressLegend = null;
        }
    }

    applyStressColorsSmooth(visualization, stressAnalysis) {
        if (!visualization || !visualization.stressColors) return;

        const geometry = this.stlMesh.geometry;
        const positions = geometry.attributes.position;
        const colors = new Float32Array(positions.count * 3);

        const stressMap = stressAnalysis.stressMap;
        
        // Collecter TOUTES les valeurs de contrainte (sauf zone d'ancrage)
        let stressValues = [];
        
        stressMap.forEach(sm => {
            if (!sm.inAnchorZone) {
                stressValues.push(sm.stress);
            }
        });
        
        // Trier les valeurs
        stressValues.sort((a, b) => a - b);
        
        // NORMALISATION AGGRESSIVE :
        // Min = 5e percentile, Max = 95e percentile
        // Cela élimine les outliers et force l'utilisation de tout le gradient
        const p05Index = Math.floor(stressValues.length * 0.05);
        const p95Index = Math.floor(stressValues.length * 0.95);
        
        let minStress = stressValues[p05Index] || 0;
        let maxStress = stressValues[p95Index] || stressValues[stressValues.length - 1];
        
        // Si ENCORE trop uniforme, forcer un écart artificiel
        if (maxStress - minStress < 0.5) {
            console.warn('⚠️ Contraintes très uniformes - Écart forcé');
            minStress = 0;
            maxStress = Math.max(5, maxStress * 2);
        }
        
        console.log('🎨 NORMALISATION AGGRESSIVE:');
        console.log('  Valeurs totales:', stressValues.length);
        console.log('  Min (P5):', minStress.toFixed(3), 'MPa');
        console.log('  Max (P95):', maxStress.toFixed(3), 'MPa');
        console.log('  Écart:', (maxStress - minStress).toFixed(3), 'MPa');
        console.log('  Ratio:', maxStress > 0 ? (maxStress / (minStress + 0.001)).toFixed(1) : 'N/A');

        // Pour chaque vertex, calculer la couleur
        for (let i = 0; i < positions.count; i++) {
            const vertex = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );

            // Appliquer les transformations du mesh
            vertex.multiplyScalar(0.1);
            vertex.applyEuler(this.stlMesh.rotation);
            vertex.add(this.stlMesh.position);

            // Trouver les 2 sections les plus proches (interpolation précise)
            const closestSections = stressMap
                .map(sm => ({
                    stress: sm.stress,
                    inAnchorZone: sm.inAnchorZone,
                    distance: vertex.distanceTo(sm.section.center)
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 2);

            let totalWeight = 0;
            let weightedStress = 0;

            closestSections.forEach(cs => {
                // Pondération inverse du cube de la distance (plus précis)
                const weight = cs.distance > 0.01 ? 1 / Math.pow(cs.distance, 3) : 10000;
                totalWeight += weight;
                weightedStress += cs.stress * weight;
            });

            const finalStress = totalWeight > 0 ? weightedStress / totalWeight : 0;

            // Normalisation STRICTE
            let ratio = 0;
            if (finalStress < minStress * 0.5) {
                // Zone d'ancrage ou très faible = bleu foncé
                ratio = 0.0;
            } else {
                // Normalisation linéaire STRICTE
                ratio = (finalStress - minStress) / (maxStress - minStress);
                
                // Clamper entre 0 et 1
                ratio = Math.max(0, Math.min(1, ratio));
                
                // Exposant pour étaler le gradient (0.7 = plus de contraste)
                ratio = Math.pow(ratio, 0.7);
            }

            // Appliquer le gradient de couleur
            const color = this.getStressColor(ratio);

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.stlMesh.material.vertexColors = true;
        this.stlMesh.material.needsUpdate = true;
        
        console.log('✅ Carte de chaleur appliquée - Contraste maximum');
    }

    getStressColor(ratio) {
        // Gradient SolidWorks : Bleu foncé -> Cyan -> Vert -> Jaune -> Orange -> Rouge
        // ratio: 0.0 (pas de contrainte) à 1.0 (contrainte maximale)
        
        if (ratio < 0.0) ratio = 0.0;
        if (ratio > 1.0) ratio = 1.0;
        
        // 6 points de couleur
        if (ratio < 0.17) {
            // Bleu foncé -> Bleu
            const t = ratio / 0.17;
            return new THREE.Color(
                0.0,
                0.0,
                0.5 + t * 0.5  // 0.5 -> 1.0
            );
        } else if (ratio < 0.33) {
            // Bleu -> Cyan
            const t = (ratio - 0.17) / 0.16;
            return new THREE.Color(
                0.0,
                t,  // 0.0 -> 1.0
                1.0
            );
        } else if (ratio < 0.50) {
            // Cyan -> Vert
            const t = (ratio - 0.33) / 0.17;
            return new THREE.Color(
                0.0,
                1.0,
                1.0 - t  // 1.0 -> 0.0
            );
        } else if (ratio < 0.67) {
            // Vert -> Jaune
            const t = (ratio - 0.50) / 0.17;
            return new THREE.Color(
                t,  // 0.0 -> 1.0
                1.0,
                0.0
            );
        } else if (ratio < 0.83) {
            // Jaune -> Orange
            const t = (ratio - 0.67) / 0.16;
            return new THREE.Color(
                1.0,
                1.0 - t * 0.5,  // 1.0 -> 0.5
                0.0
            );
        } else {
            // Orange -> Rouge vif
            const t = (ratio - 0.83) / 0.17;
            return new THREE.Color(
                1.0,
                0.5 - t * 0.5,  // 0.5 -> 0.0
                0.0
            );
        }
    }

    addBreakPointMarkers(breakPoints) {
        // Supprimer les anciens marqueurs
        const oldMarkers = this.scene.children.filter(child => child.userData.isMarker);
        oldMarkers.forEach(marker => this.scene.remove(marker));

        // Ajouter de nouveaux marqueurs
        breakPoints.forEach((bp, index) => {
            const geometry = new THREE.SphereGeometry(2, 16, 16);
            const material = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.8
            });
            const marker = new THREE.Mesh(geometry, material);
            marker.position.copy(bp.position);
            marker.userData.isMarker = true;
            this.scene.add(marker);

            // Animation de pulsation
            const initialScale = marker.scale.clone();
            let time = 0;
            const animate = () => {
                if (!this.scene.children.includes(marker)) return;
                time += 0.05;
                const scale = initialScale.clone().multiplyScalar(1 + Math.sin(time) * 0.2);
                marker.scale.copy(scale);
                requestAnimationFrame(animate);
            };
            animate();
        });
    }

    reset() {
        // Supprimer le mesh STL
        if (this.stlMesh) {
            this.scene.remove(this.stlMesh);
            this.stlMesh.geometry.dispose();
            this.stlMesh.material.dispose();
            this.stlMesh = null;
        }

        // Supprimer les marqueurs
        const markers = this.scene.children.filter(child => child.userData.isMarker);
        markers.forEach(marker => this.scene.remove(marker));
        
        // Nettoyer les visualisations
        this.clearVisualization();
        
        // Nettoyer le point d'accrochage
        this.clearHangingPoint();

        // Réinitialiser la caméra
        this.camera.position.set(80, 60, 120);
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        // Cacher le plan de coupe
        if (this.sectionPlane) {
            this.sectionPlane.material.visible = false;
        }
    }

    onWindowResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.controls.update();
        
        // Mettre à jour la position de la cible 2D si nécessaire
        if (this.hangingPoint2D) {
            this.updateTargetPosition();
        }
        
        // Rendu de la scène 3D
        this.renderer.render(this.scene, this.camera);
    }

    // Méthode pour obtenir une capture d'écran
    getScreenshot() {
        return this.renderer.domElement.toDataURL('image/png');
    }
}
