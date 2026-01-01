// Application principale
class BackpackSimulatorApp {
    constructor() {
        this.viewer = null;
        this.simulator = null;
        this.ui = null;
        this.currentSTLFile = null;
        this.currentWeight = 5.0;
        this.simulationRunning = false;
        
        // Coefficient de résistance du matériau (persiste entre les fichiers STL)
        this.materialCoefficient = 1.0;
        this.materialType = 'pla';
        
        this.init();
    }

    async init() {
        // Vérifier si le tutoriel doit être affiché
        this.checkTutorial();
        
        // Initialiser les composants
        this.initComponents();
        
        // Configurer les événements
        this.setupEventListeners();
        
        // Cacher l'écran de chargement
        setTimeout(() => {
            document.getElementById('loadingScreen').classList.add('hidden');
        }, 1000);
    }

    checkTutorial() {
        const tutorialOverlay = document.getElementById('tutorialOverlay');
        // Toujours afficher le tutoriel au démarrage
        tutorialOverlay.classList.remove('hidden');
    }

    initComponents() {
        // Initialiser le viewer 3D
        this.viewer = new Viewer3D('canvas-container');
        
        // Initialiser l'UI
        this.ui = new UIManager(this);
        
        // Initialiser la simulation 2D
        const viewerContainer = document.getElementById('canvas-container');
        if (window.Simulation2D && viewerContainer) {
            this.simulation2D = new Simulation2D(viewerContainer);
        }
    }

    setupEventListeners() {
        // Tutoriel
        document.getElementById('closeTutorial').addEventListener('click', () => {
            this.closeTutorial();
        });

        // Clic sur le step 1 = ouvrir le sélecteur de fichier
        document.getElementById('tutorialStep1').addEventListener('click', () => {
            document.getElementById('stlFileInput').click();
        });

        // Boutons header
        document.getElementById('helpBtn').addEventListener('click', () => {
            this.showHelp();
        });

        // Bouton crédits
        document.getElementById('creditsBtn').addEventListener('click', () => {
            document.getElementById('creditsOverlay').classList.remove('hidden');
        });
        
        document.getElementById('closeCredits').addEventListener('click', () => {
            document.getElementById('creditsOverlay').classList.add('hidden');
        });
        
        document.getElementById('closeCreditsBtn').addEventListener('click', () => {
            document.getElementById('creditsOverlay').classList.add('hidden');
        });
        
        // Fermer la popup crédits en cliquant en dehors
        document.getElementById('creditsOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'creditsOverlay') {
                document.getElementById('creditsOverlay').classList.add('hidden');
            }
        });

        // Bouton réglages
        document.getElementById('settingsBtn').addEventListener('click', () => {
            document.getElementById('settingsOverlay').classList.remove('hidden');
        });
        
        document.getElementById('closeSettings').addEventListener('click', () => {
            document.getElementById('settingsOverlay').classList.add('hidden');
        });
        
        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            this.applyMaterialSettings();
            document.getElementById('settingsOverlay').classList.add('hidden');
        });
        
        // Fermer la popup réglages en cliquant en dehors
        document.getElementById('settingsOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'settingsOverlay') {
                document.getElementById('settingsOverlay').classList.add('hidden');
            }
        });
        
        // Sélection du matériau
        document.getElementById('materialSelect').addEventListener('change', (e) => {
            this.onMaterialChange(e.target.value);
        });
        
        // Coefficient personnalisé - validation avec Entrée
        document.getElementById('materialCoefficient').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.applyMaterialSettings();
            }
        });

        // Upload de fichier
        const fileInput = document.getElementById('stlFileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const uploadZone = document.getElementById('fileUploadZone');

        uploadBtn.addEventListener('click', () => {
            fileInput.click();
        });

        uploadZone.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadSTLFile(e.target.files[0]);
            }
        });

        // Drag and drop
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            
            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.name.toLowerCase().endsWith('.stl')) {
                    fileInput.files = e.dataTransfer.files;
                    this.loadSTLFile(file);
                } else {
                    this.ui.showToast('Erreur', 'Veuillez sélectionner un fichier STL', 'error');
                }
            }
        });

        // Contrôles de position
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'resetPosition') {
                    this.resetPosition();
                } else if (action === 'resetRotation') {
                    this.resetRotation();
                }
            });
        });

        // Sliders de position
        ['posX', 'posY', 'posZ'].forEach(axis => {
            const slider = document.getElementById(axis);
            const valueDisplay = document.getElementById(axis + 'Value');
            
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                valueDisplay.textContent = value.toFixed(1);
                this.updatePosition(axis.replace('pos', '').toLowerCase(), value);
            });
        });

        // Slider d'épaisseur de table
        const thicknessSlider = document.getElementById('tableThickness');
        const thicknessValue = document.getElementById('tableThicknessValue');
        const thicknessDisplay = document.getElementById('tableThicknessDisplay');
        
        thicknessSlider.addEventListener('input', (e) => {
            const newThickness = parseFloat(e.target.value);
            const oldThickness = this.viewer.tableThickness || 2.1;
            
            // Créer temporairement la nouvelle table
            this.viewer.createTable(newThickness);
            
            // Vérifier si cette nouvelle épaisseur crée une collision
            if (this.viewer.stlMesh && this.checkTableCollision()) {
                // Collision détectée - restaurer l'ancienne épaisseur
                this.viewer.createTable(oldThickness);
                thicknessSlider.value = oldThickness;
                thicknessValue.textContent = oldThickness.toFixed(1) + ' cm';
                if (thicknessDisplay) thicknessDisplay.textContent = oldThickness.toFixed(1) + ' cm';
            } else {
                // Pas de collision - mettre à jour l'affichage
                thicknessValue.textContent = newThickness.toFixed(1) + ' cm';
                if (thicknessDisplay) thicknessDisplay.textContent = newThickness.toFixed(1) + ' cm';
            }
        });

        // Sliders de rotation
        ['rotX', 'rotY', 'rotZ'].forEach(axis => {
            const slider = document.getElementById(axis);
            const valueDisplay = document.getElementById(axis + 'Value');
            
            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                valueDisplay.textContent = value.toFixed(0) + '°';
                this.updateRotation(axis.replace('rot', '').toLowerCase(), value);
            });
        });
        
        // Checkbox mode libre de rotation
        document.getElementById('rotationFreeMode').addEventListener('change', (e) => {
            const freeMode = e.target.checked;
            const rotSliders = ['rotX', 'rotY', 'rotZ'];
            
            rotSliders.forEach(sliderId => {
                const slider = document.getElementById(sliderId);
                if (freeMode) {
                    slider.step = '5'; // Mode libre : 5°
                } else {
                    slider.step = '90'; // Mode par défaut : 90°
                    // Arrondir à 90° le plus proche
                    const currentValue = parseFloat(slider.value);
                    const rounded = Math.round(currentValue / 90) * 90;
                    slider.value = rounded;
                    document.getElementById(sliderId + 'Value').textContent = rounded + '°';
                    this.updateRotation(sliderId.replace('rot', '').toLowerCase(), rounded);
                }
            });
        });
        
        // Rendre les valeurs cliquables pour édition manuelle
        this.makeValuesEditable();

        // Bouton recentrer en overlay
        document.getElementById('recenterBtn').addEventListener('click', () => {
            if (this.viewer.stlMesh) {
                this.viewer.fitCameraToObject();
            }
        });

        // Slider de poids
        const weightSlider = document.getElementById('weightSlider');
        const weightValue = document.getElementById('weightValue');

        weightSlider.addEventListener('input', (e) => {
            const weight = parseFloat(e.target.value);
            this.currentWeight = weight;
            weightValue.textContent = weight.toFixed(1);
            
            // Si une simulation est en cours, mettre à jour en temps réel
            if (this.simulationRunning) {
                this.runSimulation();
            }
        });

        // Bouton de simulation COMPLÈTE
        document.getElementById('simulateBtn').addEventListener('click', () => {
            this.runSimulation();
        });
        
        // Bouton de sélection du point d'accrochage
        document.getElementById('selectHangingPointBtn').addEventListener('click', () => {
            this.selectHangingPoint();
        });

        // Redimensionnement de la fenêtre
        window.addEventListener('resize', () => {
            if (this.viewer) {
                this.viewer.onWindowResize();
            }
        });
    }

    closeTutorial() {
        document.getElementById('tutorialOverlay').classList.add('hidden');
    }

    showHelp() {
        document.getElementById('tutorialOverlay').classList.remove('hidden');
    }

    resetSimulator() {
        // Réinitialiser le viewer
        this.viewer.reset();
        
        // Réinitialiser les contrôles
        this.resetPosition();
        this.resetRotation();
        document.getElementById('weightSlider').value = 5;
        document.getElementById('weightValue').textContent = '5.0';
        this.currentWeight = 5.0;
        
        // Réinitialiser l'épaisseur de la table
        document.getElementById('tableThickness').value = 2.1;
        document.getElementById('tableThicknessValue').textContent = '2.1 cm';
        const thicknessDisplay = document.getElementById('tableThicknessDisplay');
        if (thicknessDisplay) thicknessDisplay.textContent = '2.1 cm';
        this.viewer.createTable(2.1);
        
        // Cacher les résultats
        document.getElementById('simulationResults').classList.add('hidden');
        
        // Désactiver les boutons
        document.getElementById('simulateBtn').disabled = true;
        
        this.simulationRunning = false;
        this.lastSimulationResult = null;
    }

    reset() {
        if (confirm('Voulez-vous vraiment réinitialiser le simulateur ?')) {
            // Réinitialiser le fichier
            this.currentSTLFile = null;
            document.getElementById('stlFileInput').value = '';
            document.getElementById('fileInfo').classList.add('hidden');
            
            this.resetSimulator();
            
            this.ui.showToast('Réinitialisation', 'Le simulateur a été réinitialisé', 'success');
        }
    }

    async loadSTLFile(file) {
        if (!file.name.toLowerCase().endsWith('.stl')) {
            this.ui.showToast('Erreur', 'Le fichier doit être au format STL', 'error');
            return;
        }

        // Si un fichier était déjà chargé, réinitialiser complètement le simulateur
        if (this.currentSTLFile) {
            this.resetSimulator();
        }

        this.ui.showToast('Chargement', 'Lecture du fichier STL...', 'info');

        try {
            // Lire le fichier
            const arrayBuffer = await file.arrayBuffer();
            
            // Parser le STL
            const geometry = STLParser.parse(arrayBuffer);
            
            // Calculer les informations du fichier
            const fileSize = this.formatFileSize(file.size);
            const vertexCount = geometry.attributes.position.count;
            
            // Afficher les infos du fichier
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('fileSize').textContent = fileSize;
            document.getElementById('fileInfo').classList.remove('hidden');
            
            // Charger dans le viewer
            this.viewer.loadSTL(geometry);
            
            // Stocker le fichier et la géométrie
            this.currentSTLFile = {
                file: file,
                geometry: geometry,
                name: file.name
            };
            
            // Ne pas activer le bouton de simulation ici
            // Il sera activé quand le point d'accrochage sera défini
            
            // Fermer la popup tutoriel si elle est ouverte
            this.closeTutorial();
            
            this.ui.showToast('Succès', 'Fichier chargé avec succès !', 'success');
            
        } catch (error) {
            console.error('Erreur lors du chargement du STL:', error);
            this.ui.showToast('Erreur', 'Impossible de charger le fichier STL', 'error');
        }
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    autoPosition() {
        if (!this.currentSTLFile) return;
        
        const position = this.viewer.autoPositionOnTable();
        
        // Mettre à jour les sliders
        document.getElementById('posX').value = position.x;
        document.getElementById('posXValue').textContent = position.x.toFixed(1);
        document.getElementById('posY').value = position.y;
        document.getElementById('posYValue').textContent = position.y.toFixed(1);
        document.getElementById('posZ').value = position.z;
        document.getElementById('posZValue').textContent = position.z.toFixed(1);
        
        this.ui.showToast('Position', 'Objet positionné automatiquement', 'success');
    }

    resetPosition() {
        document.getElementById('posX').value = 6;
        document.getElementById('posXValue').textContent = '6.0';
        document.getElementById('posY').value = 0;
        document.getElementById('posYValue').textContent = '0.0';
        document.getElementById('posZ').value = 10;
        document.getElementById('posZValue').textContent = '10.0';
        
        if (this.viewer.stlMesh) {
            // Recalculer la position correcte en Y
            const box = new THREE.Box3().setFromObject(this.viewer.stlMesh);
            const size = box.getSize(new THREE.Vector3());
            const y = 2.1 - size.y * 0.2;
            this.viewer.stlMesh.position.set(6, y, 10);
        }
    }

    resetRotation() {
        document.getElementById('rotX').value = 0;
        document.getElementById('rotXValue').textContent = '0°';
        document.getElementById('rotY').value = 0;
        document.getElementById('rotYValue').textContent = '0°';
        document.getElementById('rotZ').value = 0;
        document.getElementById('rotZValue').textContent = '0°';
        
        if (this.viewer.stlMesh) {
            this.viewer.stlMesh.rotation.set(0, 0, 0);
        }
    }

    updatePosition(axis, value) {
        if (!this.viewer.stlMesh) return;
        
        // Sauvegarder position actuelle
        const oldPosition = this.viewer.stlMesh.position.clone();
        
        // Appliquer nouvelle position
        this.viewer.stlMesh.position[axis] = value;
        
        // IMPORTANT : Mettre à jour la matrice monde avant collision
        this.viewer.stlMesh.updateMatrixWorld(true);
        
        // Vérifier collision avec la table
        if (this.checkTableCollision()) {
            // Collision détectée - restaurer ancienne position
            this.viewer.stlMesh.position.copy(oldPosition);
            this.viewer.stlMesh.updateMatrixWorld(true);
            
            // Restaurer slider
            const sliderId = 'pos' + axis.toUpperCase();
            document.getElementById(sliderId).value = oldPosition[axis];
            document.getElementById(sliderId + 'Value').textContent = oldPosition[axis].toFixed(1);
        }
    }
    
    /**
     * Vérifier si l'objet intersecte le PLATEAU SOLIDE de la table
     * La table est un BoxGeometry(150, thickness, 80) positionné à (-75, thickness/2, 40)
     * On vérifie les vertices ET les arêtes avec échantillonnage DENSE
     */
    checkTableCollision() {
        if (!this.viewer.stlMesh || !this.viewer.tableMesh) return false;
        
        const mesh = this.viewer.stlMesh;
        const tableThickness = this.viewer.tableThickness || 2.1;
        
        // La table est centrée à (-75, thickness/2, 40) avec dimensions (150, thickness, 80)
        // Limites EXACTES du volume de la table en coordonnées monde
        const tableBounds = {
            xMin: -150,  // -75 - 150/2
            xMax: 0,     // -75 + 150/2
            yMin: 0,     // thickness/2 - thickness/2
            yMax: tableThickness, // thickness/2 + thickness/2
            zMin: 0,     // 40 - 80/2
            zMax: 80     // 40 + 80/2
        };
        
        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;
        
        // Fonction pour transformer un vertex en coordonnées monde
        const transformVertex = (i) => {
            const vertex = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            vertex.multiplyScalar(0.1);
            vertex.applyEuler(mesh.rotation);
            vertex.add(mesh.position);
            return vertex;
        };
        
        // Fonction pour vérifier si un point est dans la table
        const isInTable = (v) => {
            return v.x >= tableBounds.xMin && v.x <= tableBounds.xMax &&
                   v.y >= tableBounds.yMin && v.y <= tableBounds.yMax &&
                   v.z >= tableBounds.zMin && v.z <= tableBounds.zMax;
        };
        
        // Vérifier chaque triangle (3 vertices)
        for (let i = 0; i < positions.count; i += 3) {
            const v0 = transformVertex(i);
            const v1 = transformVertex(i + 1);
            const v2 = transformVertex(i + 2);
            
            // Vérifier si au moins un vertex est dans la table
            if (isInTable(v0) || isInTable(v1) || isInTable(v2)) {
                return true;
            }
            
            // Vérifier les arêtes avec échantillonnage TRÈS DENSE (tous les 0.2 cm)
            const checkEdgeDense = (va, vb) => {
                const distance = va.distanceTo(vb);
                const steps = Math.ceil(distance / 0.2); // Un point tous les 0.2 cm
                
                for (let step = 1; step < steps; step++) {
                    const t = step / steps;
                    const vMid = new THREE.Vector3().lerpVectors(va, vb, t);
                    if (isInTable(vMid)) {
                        return true;
                    }
                }
                return false;
            };
            
            if (checkEdgeDense(v0, v1) || checkEdgeDense(v1, v2) || checkEdgeDense(v2, v0)) {
                return true;
            }
        }
        
        // Aucune collision détectée
        return false;
    }

    updateRotation(axis, value) {
        if (!this.viewer.stlMesh) return;
        
        // Sauvegarder rotation actuelle
        const oldRotation = this.viewer.stlMesh.rotation.clone();
        
        // Convertir les degrés en radians
        const radians = (value * Math.PI) / 180;
        this.viewer.stlMesh.rotation[axis] = radians;
        
        // IMPORTANT : Mettre à jour la matrice monde avant collision
        this.viewer.stlMesh.updateMatrixWorld(true);
        
        // Vérifier collision avec le plateau solide
        if (this.checkTableCollision()) {
            // Collision détectée - restaurer ancienne rotation
            this.viewer.stlMesh.rotation.copy(oldRotation);
            this.viewer.stlMesh.updateMatrixWorld(true);
            
            // Restaurer slider
            const sliderId = 'rot' + axis.toUpperCase();
            const oldDegrees = (oldRotation[axis] * 180) / Math.PI;
            document.getElementById(sliderId).value = oldDegrees;
            document.getElementById(sliderId + 'Value').textContent = oldDegrees.toFixed(0) + '°';
        }
    }

    changeView(view) {
        if (view === 'recenter') {
            // Recentrer la vue sur l'objet et le bord de la table
            if (this.viewer.stlMesh) {
                this.viewer.fitCameraToObjectAndTable();
            }
        } else {
            this.viewer.setView(view);
        }
    }
    
    selectHangingPoint() {
        if (!this.currentSTLFile) {
            this.ui.showToast('Erreur', 'Chargez d\'abord un fichier STL', 'error');
            return;
        }
        
        this.viewer.enableHangingPointSelection();
        
        // Changer le texte du bouton
        const btn = document.getElementById('selectHangingPointBtn');
        btn.innerHTML = '<span>⏳</span> Cliquez sur le modèle...';
        btn.disabled = true;
    }
    
    onHangingPointSelected(point) {
        // Activer le bouton de simulation UNIQUE
        document.getElementById('simulateBtn').disabled = false;
        
        // Réinitialiser le bouton de sélection
        const btn = document.getElementById('selectHangingPointBtn');
        btn.innerHTML = '<span>🎯</span> Modifier le point d\'accrochage';
        btn.disabled = false;
    }
    
    clearHangingPoint() {
        this.viewer.clearHangingPoint();
        document.getElementById('simulateBtn').disabled = true;
        
        const btn = document.getElementById('selectHangingPointBtn');
        btn.innerHTML = '<span>🎯</span> Cliquer sur le modèle pour placer le point';
    }

    /**
     * Vérifier que le support est positionné sur la table
     * Au moins une partie doit être dans l'espace de la table (X < 0 et Y > 0)
     */
    checkSupportOnTable() {
        if (!this.currentSTLFile || !this.viewer.stlMesh) return false;
        
        const geometry = this.currentSTLFile.geometry;
        const positions = geometry.attributes.position;
        const meshPosition = this.viewer.stlMesh.position;
        const meshRotation = this.viewer.stlMesh.rotation;
        
        let hasVertexOnTable = false;
        const tableEdgeX = 0; // Bord de table à X = 0
        const tableTopY = 2.1; // Dessus de table
        
        for (let i = 0; i < positions.count; i++) {
            // Position en coordonnées monde
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            v.multiplyScalar(0.1); // Échelle STL
            v.applyEuler(meshRotation);
            v.add(meshPosition);
            
            // Vérifier si ce vertex est sur/dans la table (X < 0 et Y entre 0 et tableTop+marge)
            if (v.x < tableEdgeX + 1 && v.y > -1 && v.y < tableTopY + 5) {
                hasVertexOnTable = true;
                break;
            }
        }
        
        if (!hasVertexOnTable) {
            console.log('❌ Support non positionné sur la table');
        }
        
        return hasVertexOnTable;
    }

    /**
     * Vérifier que le point d'accrochage est sur le support 3D
     */
    checkHangingPointOnSupport() {
        if (!this.viewer.hangingPoint || !this.viewer.stlMesh) return false;
        
        const hangPoint = this.viewer.hangingPoint;
        const geometry = this.currentSTLFile.geometry;
        const positions = geometry.attributes.position;
        const meshPosition = this.viewer.stlMesh.position;
        const meshRotation = this.viewer.stlMesh.rotation;
        
        // Calculer la bounding box du support en coordonnées monde
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        for (let i = 0; i < positions.count; i++) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            v.multiplyScalar(0.1);
            v.applyEuler(meshRotation);
            v.add(meshPosition);
            
            minX = Math.min(minX, v.x);
            maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y);
            maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z);
            maxZ = Math.max(maxZ, v.z);
        }
        
        // Ajouter une marge de tolérance
        const margin = 1.0;
        
        const isInBounds = (
            hangPoint.x >= minX - margin && hangPoint.x <= maxX + margin &&
            hangPoint.y >= minY - margin && hangPoint.y <= maxY + margin &&
            hangPoint.z >= minZ - margin && hangPoint.z <= maxZ + margin
        );
        
        if (!isInBounds) {
            console.log('❌ Point d\'accrochage hors du support');
            console.log('  Point:', hangPoint.x.toFixed(1), hangPoint.y.toFixed(1), hangPoint.z.toFixed(1));
            console.log('  Bounds X:', minX.toFixed(1), '-', maxX.toFixed(1));
            console.log('  Bounds Y:', minY.toFixed(1), '-', maxY.toFixed(1));
            console.log('  Bounds Z:', minZ.toFixed(1), '-', maxZ.toFixed(1));
        }
        
        return isInBounds;
    }

    async runSimulation() {
        if (!this.currentSTLFile) {
            this.ui.showToast('Erreur', 'Aucun fichier STL chargé', 'error');
            return;
        }

        if (!this.viewer.hangingPoint) {
            this.ui.showToast('Erreur', 'Veuillez définir le point d\'accrochage du sac', 'error');
            return;
        }

        // === GARDE-FOU 1 : Vérifier que le support est sur la table ===
        if (!this.checkSupportOnTable()) {
            this.ui.showToast('Erreur', 'Le support doit être positionné sur la table', 'error');
            return;
        }

        // === GARDE-FOU 2 : Vérifier que le point d'accrochage est sur le support ===
        if (!this.checkHangingPointOnSupport()) {
            this.ui.showToast('Erreur', 'Le point d\'accrochage doit être sur le support', 'error');
            return;
        }

        this.simulationRunning = true;
        
        // Afficher le loader
        const loader = document.getElementById('simulationLoader');
        if (loader) loader.classList.remove('hidden');

        // Attendre un frame pour que le loader s'affiche
        await new Promise(resolve => setTimeout(resolve, 50));

        const position = this.viewer.stlMesh.position.clone();
        const rotation = this.viewer.stlMesh.rotation.clone();

        // === SIMULATION 2D ===
        let maxWeight2D = null;
        if (this.simulation2D) {
            try {
                console.log('📐 Lancement de la simulation 2D...');
                console.log('📐 Coefficient de matériau:', this.materialCoefficient);
                
                // Extraire le profil 2D
                const profile = this.simulation2D.extractProfile(
                    this.currentSTLFile.geometry,
                    position,
                    rotation,
                    2.1 // Épaisseur de table
                );
                
                if (profile && profile.points && profile.points.length > 0) {
                    // Analyser la structure
                    const structure = this.simulation2D.analyzeStructure(this.viewer.hangingPoint);
                    
                    if (structure && structure.freeSections && structure.freeSections.length > 0) {
                        // Calculer la charge max et appliquer le coefficient de matériau
                        maxWeight2D = this.simulation2D.calculateMaxLoad() * this.materialCoefficient;
                        console.log('📐 Poids max (simulation 2D avec coefficient):', maxWeight2D.toFixed(1), 'kg');
                        
                        // Ne pas afficher la fenêtre 2D (calcul en arrière-plan)
                        // this.simulation2D.show();
                    } else {
                        console.log('⚠️ Pas de sections libres détectées');
                    }
                } else {
                    console.log('⚠️ Profil 2D vide');
                }
            } catch (error) {
                console.error('❌ Erreur simulation 2D:', error);
            }
        }

        // === ANALYSE GÉOMÉTRIQUE (pour la texture 3D) ===
        let result;
        if (window.GeometryAnalysisEngine) {
            console.log('🚀 Utilisation du moteur d\'analyse géométrique');
            const engine = new GeometryAnalysisEngine();
            result = engine.simulateWithHangingPoint(
                this.currentSTLFile.geometry,
                position,
                rotation,
                this.viewer.hangingPoint,
                this.currentWeight
            );
            
            // Si on a un résultat 2D, l'utiliser pour le poids max
            if (maxWeight2D !== null) {
                result.maxWeight = maxWeight2D;
                result.failureAnalysis.maxSafeWeight = maxWeight2D;
            } else {
                // Sinon appliquer le coefficient au résultat de GeometryAnalysisEngine
                result.maxWeight = result.maxWeight * this.materialCoefficient;
                result.failureAnalysis.maxSafeWeight = result.failureAnalysis.maxSafeWeight * this.materialCoefficient;
                console.log('📐 Poids max (géométrie avec coefficient):', result.maxWeight.toFixed(1), 'kg');
            }
        } else {
            console.error('❌ Moteur non disponible');
            this.ui.showToast('Erreur', 'Moteur de simulation non chargé', 'error');
            if (loader) loader.classList.add('hidden');
            return;
        }

        console.log('📊 Résultats:', result);

        this.displayAdvancedSimulationResults(result);
        this.viewer.visualizeStressWithTexture(result, this.currentWeight);
        this.updateIndicators(result);
        this.lastSimulationResult = result;

        this.simulationRunning = false;
        
        // Cacher le loader
        if (loader) loader.classList.add('hidden');
    }

    displayAdvancedSimulationResults(result) {
        const resultsDiv = document.getElementById('simulationResults');
        const statusDiv = document.getElementById('resultStatus');
        const detailsDiv = document.getElementById('resultDetails');

        // Recalculer le verdict en comparant poids max supporté vs poids demandé
        const maxWeight = result.maxWeight;
        const requestedWeight = this.currentWeight;
        
        let statusClass = '';
        let statusText = '';
        let statusIcon = '';
        let safety = '';

        if (maxWeight >= requestedWeight) {
            // Le support peut tenir le poids demandé
            statusClass = 'success';
            statusIcon = '✅';
            statusText = 'Ton support TIENT !';
            safety = 'safe';
        } else if (maxWeight >= requestedWeight * 0.7) {
            // Le support est proche de la limite
            statusClass = 'warning';
            statusIcon = '⚠️';
            statusText = 'Attention : limite de résistance';
            safety = 'warning';
        } else {
            // Le support ne peut pas tenir le poids demandé
            statusClass = 'danger';
            statusIcon = '❌';
            statusText = 'Ton support va CASSER !';
            safety = 'danger';
        }

        statusDiv.className = `result-status ${statusClass}`;
        statusDiv.innerHTML = `${statusIcon} ${statusText}`;

        // Récupérer les infos du bras de levier
        const leverArm = result.failureAnalysis ? result.failureAnalysis.leverArm : null;
        let leverAdvice = '';
        let leverColor = '#4CAF50';
        
        if (leverArm !== null && leverArm !== undefined) {
            if (leverArm <= 2) {
                leverAdvice = '✓ Proche du bord';
                leverColor = '#4CAF50';
            } else if (leverArm <= 4) {
                leverAdvice = 'Distance correcte';
                leverColor = '#8BC34A';
            } else if (leverArm <= 6) {
                leverAdvice = '⚠ Un peu loin';
                leverColor = '#FF9800';
            } else {
                leverAdvice = '❌ Trop loin du bord !';
                leverColor = '#f44336';
            }
        }

        // Couleur du poids max basée sur le verdict recalculé
        const weightColor = safety === 'safe' ? '#4CAF50' : safety === 'warning' ? '#FF9800' : '#f44336';

        // Affichage SIMPLIFIÉ pour les élèves
        let detailsHTML = `
            <p style="font-size: 16px; margin: 15px 0;"><strong>⚖️ Poids maximum estimé :</strong><br>
            <span style="font-size: 24px; color: ${weightColor};">${result.maxWeight.toFixed(1)} kg</span>
            <span style="font-size: 14px; color: #888;"> (demandé : ${requestedWeight.toFixed(1)} kg)</span></p>
        `;
        
        // Ajouter les infos du point d'accrochage
        if (leverArm !== null && leverArm !== undefined) {
            detailsHTML += `
                <p style="font-size: 14px; margin: 10px 0; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px;">
                    <strong>🎯 Point d'accrochage :</strong><br>
                    <span style="color: ${leverColor};">${leverArm.toFixed(1)} cm du bord — ${leverAdvice}</span>
                </p>
            `;
        }

        detailsDiv.innerHTML = detailsHTML;
        resultsDiv.classList.remove('hidden');

        // Toast de résultat basé sur le verdict recalculé
        if (safety === 'safe') {
            this.ui.showToast('✅ Bravo !', `Ton support peut tenir ${result.maxWeight.toFixed(1)} kg`, 'success');
        } else if (safety === 'warning') {
            this.ui.showToast('⚠️ Attention', 'Ton support est à la limite !', 'warning');
        } else {
            this.ui.showToast('❌ Échec', 'Le support va casser, modifie ton design !', 'error');
        }
    }

    updateIndicators(result) {
        const stabilityIndicator = document.getElementById('stabilityIndicator');
        const stabilityValue = document.getElementById('stabilityValue');
        const stressValue = document.getElementById('stressValue');

        // Recalculer le verdict en comparant poids max vs poids demandé
        const maxWeight = result.maxWeight;
        const requestedWeight = this.currentWeight;
        
        let safety = '';
        if (maxWeight >= requestedWeight) {
            safety = 'safe';
        } else if (maxWeight >= requestedWeight * 0.7) {
            safety = 'warning';
        } else {
            safety = 'danger';
        }

        // Mise à jour simple : TIENT ou VA CASSER
        stabilityIndicator.className = 'stability-indicator';
        if (safety === 'safe') {
            stabilityIndicator.classList.add('good');
            stabilityValue.textContent = '✅ TIENT';
        } else if (safety === 'warning') {
            stabilityIndicator.classList.add('warning');
            stabilityValue.textContent = '⚠️ Limite';
        } else {
            stabilityIndicator.classList.add('danger');
            stabilityValue.textContent = '❌ CASSE';
        }

        // Afficher le poids maximum au lieu de la contrainte
        stressValue.textContent = `Max: ${result.maxWeight.toFixed(1)} kg`;
    }

    exportReport() {
        if (!this.lastSimulationResult) {
            this.ui.showToast('Erreur', 'Aucune simulation à exporter', 'error');
            return;
        }

        this.ui.showToast('Export', 'Génération du rapport PDF...', 'info');

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // Titre
            doc.setFontSize(20);
            doc.setTextColor(76, 175, 80);
            doc.text('Rapport de Simulation', 105, 20, { align: 'center' });

            // Informations du fichier
            doc.setFontSize(14);
            doc.setTextColor(0, 0, 0);
            doc.text('Informations du fichier', 20, 40);
            
            doc.setFontSize(11);
            doc.text(`Nom : ${this.currentSTLFile.name}`, 20, 50);
            doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`, 20, 57);
            doc.text(`Poids testé : ${this.currentWeight} kg`, 20, 64);

            // Résultats
            doc.setFontSize(14);
            doc.text('Résultats de la simulation', 20, 80);

            doc.setFontSize(11);
            const result = this.lastSimulationResult;
            
            let statusText = '';
            if (result.safety === 'safe') {
                doc.setTextColor(76, 175, 80);
                statusText = 'VALIDÉ - Le support est solide';
            } else if (result.safety === 'warning') {
                doc.setTextColor(255, 152, 0);
                statusText = 'ATTENTION - Support fragile';
            } else {
                doc.setTextColor(244, 67, 54);
                statusText = 'ÉCHEC - Le support va casser';
            }
            
            doc.text(statusText, 20, 90);
            
            doc.setTextColor(0, 0, 0);
            doc.text(`Contrainte maximale : ${result.maxStress.toFixed(2)} MPa`, 20, 100);
            doc.text(`Point critique : ${result.criticalPoint}`, 20, 107);
            doc.text(`Coefficient de sécurité : ${result.safetyFactor.toFixed(2)}`, 20, 114);

            // Recommandation
            doc.setFontSize(14);
            doc.text('Recommandation', 20, 130);
            
            doc.setFontSize(11);
            const lines = doc.splitTextToSize(result.recommendation, 170);
            doc.text(lines, 20, 140);

            // Footer
            doc.setFontSize(9);
            doc.setTextColor(150, 150, 150);
            doc.text('Simulateur Support Sac à Dos - Collège', 105, 280, { align: 'center' });

            // Sauvegarder
            const fileName = `rapport_${this.currentSTLFile.name.replace('.stl', '')}_${Date.now()}.pdf`;
            doc.save(fileName);

            this.ui.showToast('Succès', 'Rapport PDF généré !', 'success');

        } catch (error) {
            console.error('Erreur lors de l\'export:', error);
            this.ui.showToast('Erreur', 'Impossible de générer le rapport', 'error');
        }
    }
    
    makeValuesEditable() {
        // Position
        ['posX', 'posY', 'posZ'].forEach(axis => {
            const valueSpan = document.getElementById(axis + 'Value');
            const slider = document.getElementById(axis);
            
            this.makeValueEditable(valueSpan, slider, (value) => {
                const numValue = parseFloat(value);
                const min = parseFloat(slider.min);
                const max = parseFloat(slider.max);
                if (!isNaN(numValue) && numValue >= min && numValue <= max) {
                    slider.value = numValue;
                    valueSpan.textContent = numValue.toFixed(1);
                    this.updatePosition(axis.replace('pos', '').toLowerCase(), numValue);
                    return true;
                }
                return false;
            });
        });
        
        // Rotation
        ['rotX', 'rotY', 'rotZ'].forEach(axis => {
            const valueSpan = document.getElementById(axis + 'Value');
            const slider = document.getElementById(axis);
            
            this.makeValueEditable(valueSpan, slider, (value) => {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue >= 0 && numValue <= 360) {
                    slider.value = numValue;
                    valueSpan.textContent = numValue.toFixed(0) + '°';
                    this.updateRotation(axis.replace('rot', '').toLowerCase(), numValue);
                    return true;
                }
                return false;
            });
        });
        
        // Épaisseur de table
        const thicknessValue = document.getElementById('tableThicknessValue');
        const thicknessSlider = document.getElementById('tableThickness');
        
        this.makeValueEditable(thicknessValue, thicknessSlider, (value) => {
            const numValue = parseFloat(value);
            const min = parseFloat(thicknessSlider.min);
            const max = parseFloat(thicknessSlider.max);
            if (!isNaN(numValue) && numValue >= min && numValue <= max) {
                const oldThickness = this.viewer.tableThickness || 2.1;
                
                // Créer temporairement la nouvelle table
                this.viewer.createTable(numValue);
                
                // Vérifier si cette nouvelle épaisseur crée une collision
                if (this.viewer.stlMesh && this.checkTableCollision()) {
                    // Collision détectée - restaurer l'ancienne épaisseur
                    this.viewer.createTable(oldThickness);
                    return false;
                }
                
                // Pas de collision - valider le changement
                thicknessSlider.value = numValue;
                thicknessValue.textContent = numValue.toFixed(1) + ' cm';
                return true;
            }
            return false;
        });
    }
    
    // Coefficients de résistance des matériaux
    getMaterialCoefficients() {
        return {
            pla: { coefficient: 1.0, hint: 'Le PLA est le matériau standard pour l\'impression 3D' },
            wood: { coefficient: 4.0, hint: 'Le bois est plus résistant que le plastique' },
            metal: { coefficient: 8.0, hint: 'Le métal est le matériau le plus résistant' },
            custom: { coefficient: this.materialCoefficient, hint: 'Coefficient personnalisé' }
        };
    }
    
    onMaterialChange(materialType) {
        const materials = this.getMaterialCoefficients();
        const coeffInput = document.getElementById('materialCoefficient');
        const hintText = document.getElementById('materialHint');
        
        this.materialType = materialType;
        
        if (materialType === 'custom') {
            // Mode personnalisé - permettre l'édition
            coeffInput.readOnly = false;
            coeffInput.value = this.materialCoefficient;
            hintText.textContent = materials.custom.hint;
        } else {
            // Matériau prédéfini - lecture seule
            coeffInput.readOnly = true;
            coeffInput.value = materials[materialType].coefficient;
            hintText.textContent = materials[materialType].hint;
            this.materialCoefficient = materials[materialType].coefficient;
        }
    }
    
    applyMaterialSettings() {
        const coeffInput = document.getElementById('materialCoefficient');
        const newCoeff = parseFloat(coeffInput.value);
        
        if (!isNaN(newCoeff) && newCoeff >= 0.1 && newCoeff <= 10) {
            this.materialCoefficient = newCoeff;
            console.log('📐 Coefficient de matériau appliqué:', this.materialCoefficient);
            
            // Si une simulation a déjà été faite, la relancer automatiquement
            if (this.lastSimulationResult && this.currentSTLFile && this.viewer.hangingPoint) {
                this.runSimulation();
            }
        } else {
            // Valeur invalide - restaurer
            coeffInput.value = this.materialCoefficient;
            this.ui.showToast('Erreur', 'Coefficient invalide (0.1 à 10)', 'error');
        }
    }
    
    makeValueEditable(span, slider, onUpdate) {
        let isEditing = false;
        
        const startEditing = () => {
            // Éviter les doubles éditions
            if (isEditing) return;
            isEditing = true;
            
            const originalText = span.textContent;
            const originalValue = parseFloat(originalText);
            
            span.classList.add('editing');
            span.contentEditable = true;
            span.textContent = originalValue; // Enlever unités
            
            // Focus et sélection avec un léger délai pour assurer que tout fonctionne
            setTimeout(() => {
                span.focus();
                
                // Sélectionner tout le texte
                const range = document.createRange();
                range.selectNodeContents(span);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }, 0);
            
            const finish = (save) => {
                if (!isEditing) return; // Éviter les doubles appels
                span.contentEditable = false;
                span.classList.remove('editing');
                isEditing = false;
                
                if (save) {
                    const newValue = span.textContent.trim();
                    if (!onUpdate(newValue)) {
                        // Valeur invalide, restaurer
                        span.textContent = originalText;
                    }
                } else {
                    // Annuler, restaurer
                    span.textContent = originalText;
                }
            };
            
            const onKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    span.removeEventListener('keydown', onKeyDown);
                    finish(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    span.removeEventListener('keydown', onKeyDown);
                    finish(false);
                }
            };
            
            span.addEventListener('keydown', onKeyDown);
            
            // Attendre un peu avant d'activer le blur pour éviter qu'il se déclenche immédiatement
            setTimeout(() => {
                span.addEventListener('blur', () => {
                    span.removeEventListener('keydown', onKeyDown);
                    finish(true);
                }, { once: true });
            }, 100);
        };
        
        // Utiliser click simple
        span.addEventListener('click', (e) => {
            if (!isEditing) {
                e.stopPropagation();
                startEditing();
            }
        });
    }
}

// Initialiser l'application au chargement
document.addEventListener('DOMContentLoaded', () => {
    window.app = new BackpackSimulatorApp();
});
