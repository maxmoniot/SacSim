// Application principale
class BackpackSimulatorApp {
    constructor() {
        this.viewer = null;
        this.simulator = null;
        this.ui = null;
        this.currentSTLFile = null;
        this.currentWeight = 5.0;
        this.simulationRunning = false;
        
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
        const dontShow = localStorage.getItem('hideTutorial');
        const tutorialOverlay = document.getElementById('tutorialOverlay');
        
        if (!dontShow) {
            tutorialOverlay.classList.remove('hidden');
        }
    }

    initComponents() {
        // Initialiser le viewer 3D
        this.viewer = new Viewer3D('canvas-container');
        
        // Initialiser l'UI
        this.ui = new UIManager(this);
    }

    setupEventListeners() {
        // Tutoriel
        document.getElementById('closeTutorial').addEventListener('click', () => {
            this.closeTutorial();
        });

        document.getElementById('dontShowAgain').addEventListener('change', (e) => {
            if (e.target.checked) {
                localStorage.setItem('hideTutorial', 'true');
            } else {
                localStorage.removeItem('hideTutorial');
            }
        });

        // Boutons header
        document.getElementById('helpBtn').addEventListener('click', () => {
            this.showHelp();
        });

        document.getElementById('resetBtn').addEventListener('click', () => {
            this.reset();
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
        
        thicknessSlider.addEventListener('input', (e) => {
            const thickness = parseFloat(e.target.value);
            thicknessValue.textContent = thickness.toFixed(1) + ' cm';
            this.viewer.createTable(thickness);
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
                this.viewer.fitCameraToObjectAndTable();
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

        // Bouton d'export
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportReport();
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

    reset() {
        if (confirm('Voulez-vous vraiment réinitialiser le simulateur ?')) {
            // Réinitialiser le fichier
            this.currentSTLFile = null;
            document.getElementById('stlFileInput').value = '';
            document.getElementById('fileInfo').classList.add('hidden');
            
            // Réinitialiser le viewer
            this.viewer.reset();
            
            // Réinitialiser les contrôles
            this.resetPosition();
            document.getElementById('weightSlider').value = 5;
            document.getElementById('weightValue').textContent = '5.0';
            this.currentWeight = 5.0;
            
            // Cacher les résultats
            document.getElementById('simulationResults').classList.add('hidden');
            document.getElementById('analysisContent').innerHTML = '<p class="no-data">Charge un fichier STL pour commencer l\'analyse</p>';
            
            // Désactiver les boutons
            document.getElementById('simulateBtn').disabled = true;
            document.getElementById('exportBtn').disabled = true;
            
            this.simulationRunning = false;
            
            this.ui.showToast('Réinitialisation', 'Le simulateur a été réinitialisé', 'success');
        }
    }

    async loadSTLFile(file) {
        if (!file.name.toLowerCase().endsWith('.stl')) {
            this.ui.showToast('Erreur', 'Le fichier doit être au format STL', 'error');
            return;
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
            
            // Analyser la géométrie
            this.analyzeGeometry(geometry);
            
            // Activer les boutons
            document.getElementById('simulateBtn').disabled = false;
            
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

    analyzeGeometry(geometry) {
        // Calculer directement les dimensions depuis la géométrie
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox.getSize(size);
        
        // La géométrie est affichée avec scale 0.1
        const vertexCount = geometry.attributes.position.count;
        const faceCount = Math.floor(vertexCount / 3);
        
        const html = `
            <div class="analysis-item">
                <div class="analysis-label">Dimensions</div>
                <div class="analysis-value">${(size.x / 10).toFixed(1)} × ${(size.y / 10).toFixed(1)} × ${(size.z / 10).toFixed(1)} cm</div>
            </div>
            <div class="analysis-item">
                <div class="analysis-label">Vertices</div>
                <div class="analysis-value">${vertexCount.toLocaleString()}</div>
            </div>
            <div class="analysis-item">
                <div class="analysis-label">Triangles</div>
                <div class="analysis-value">${faceCount.toLocaleString()}</div>
            </div>
        `;
        
        document.getElementById('analysisContent').innerHTML = html;
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
            
            this.ui.showToast('Collision', 'L\'objet traverse le plateau de la table', 'warning');
        }
    }
    
    /**
     * Vérifier si l'objet intersecte le PLATEAU SOLIDE de la table
     * Utilise les bounding boxes pour une détection géométrique précise
     */
    checkTableCollision() {
        // Collisions désactivées - Les élèves apprennent par les résultats de simulation
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
            
            this.ui.showToast('Collision', 'Cette rotation traverse le plateau de la table', 'warning');
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
        this.ui.showToast('Sélection', 'Cliquez sur le modèle pour placer le point d\'accrochage du sac', 'info');
        
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
        
        this.ui.showToast('Succès', 'Point d\'accrochage défini !', 'success');
    }
    
    clearHangingPoint() {
        this.viewer.clearHangingPoint();
        document.getElementById('simulateBtn').disabled = true;
        
        const btn = document.getElementById('selectHangingPointBtn');
        btn.innerHTML = '<span>🎯</span> Cliquer sur le modèle pour placer le point';
        
        this.ui.showToast('Info', 'Point d\'accrochage effacé', 'info');
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

        this.simulationRunning = true;
        
        this.ui.showToast('Simulation', 'Lancement simulation complète...', 'info');

        // Obtenir la position et rotation actuelles
        const position = this.viewer.stlMesh.position.clone();
        const rotation = this.viewer.stlMesh.rotation.clone();

        // Créer le moteur de simulation avancé
        const advancedEngine = new AdvancedPhysicsEngine();

        // Exécuter l'analyse de contraintes
        const result = advancedEngine.simulateWithHangingPoint(
            this.currentSTLFile.geometry,
            position,
            rotation,
            this.viewer.hangingPoint,
            this.currentWeight
        );

        console.log('📊 Résultats analyse contraintes:', result);

        // Afficher les résultats de contraintes
        this.displayAdvancedSimulationResults(result);

        // Visualiser les contraintes sur le modèle avec TEXTURE
        this.viewer.visualizeStressWithTexture(result);

        // Mettre à jour les indicateurs
        this.updateIndicators(result);

        // Stocker les résultats
        this.lastSimulationResult = result;

        // Activer l'export
        document.getElementById('exportBtn').disabled = false;
        this.simulationRunning = false;
    }

    displayAdvancedSimulationResults(result) {
        const resultsDiv = document.getElementById('simulationResults');
        const statusDiv = document.getElementById('resultStatus');
        const detailsDiv = document.getElementById('resultDetails');

        let statusClass = '';
        let statusText = '';
        let statusIcon = '';

        if (result.safety === 'safe') {
            statusClass = 'success';
            statusIcon = '✅';
            statusText = 'Ton support est SOLIDE !';
        } else if (result.safety === 'warning') {
            statusClass = 'warning';
            statusIcon = '⚠️';
            statusText = 'Attention : Support fragile';
        } else {
            statusClass = 'danger';
            statusIcon = '❌';
            statusText = 'DANGER : Le support va casser !';
        }

        statusDiv.className = `result-status ${statusClass}`;
        statusDiv.innerHTML = `${statusIcon} ${statusText}`;

        let detailsHTML = `
            <p><strong>💪 Contrainte maximale :</strong> ${result.failureAnalysis.maxStress.toFixed(2)} MPa</p>
            <p><strong>🔢 Facteur de sécurité :</strong> ${result.failureAnalysis.safetyFactor.toFixed(2)}</p>
            <p><strong>⚖️ Poids maximum sûr :</strong> ${result.maxWeight.toFixed(1)} kg</p>
            <p><strong>📏 Bras de levier :</strong> ${result.forces.leverLength.toFixed(1)} cm</p>
            <p><strong>🔄 Moment de flexion :</strong> ${result.forces.bendingMoment.toFixed(2)} N⋅m</p>
        `;

        if (result.failureAnalysis.failurePoint) {
            const fp = result.failureAnalysis.failurePoint;
            detailsHTML += `
                <p><strong>📍 Point de rupture :</strong><br>
                X: ${fp.x.toFixed(1)} cm, Y: ${fp.y.toFixed(1)} cm, Z: ${fp.z.toFixed(1)} cm</p>
            `;
        }

        detailsHTML += `<p style="margin-top: 15px; font-style: italic;">${result.failureAnalysis.message}</p>`;

        detailsDiv.innerHTML = detailsHTML;
        resultsDiv.classList.remove('hidden');

        // Toast de résultat
        if (result.safety === 'safe') {
            this.ui.showToast('Simulation réussie', 'Ton support peut supporter ce poids !', 'success');
        } else if (result.safety === 'warning') {
            this.ui.showToast('Attention', 'Le support est fragile, renforce-le !', 'warning');
        } else {
            this.ui.showToast('Échec', 'Le support va casser, modifie ton design !', 'error');
        }
    }

    updateIndicators(result) {
        const stabilityIndicator = document.getElementById('stabilityIndicator');
        const stabilityValue = document.getElementById('stabilityValue');
        const stressValue = document.getElementById('stressValue');

        // Mise à jour de la stabilité
        stabilityIndicator.className = 'stability-indicator';
        if (result.safety === 'safe') {
            stabilityIndicator.classList.add('good');
            stabilityValue.textContent = 'Excellent';
        } else if (result.safety === 'warning') {
            stabilityIndicator.classList.add('warning');
            stabilityValue.textContent = 'Fragile';
        } else {
            stabilityIndicator.classList.add('danger');
            stabilityValue.textContent = 'Instable';
        }

        // Mise à jour de la contrainte
        const maxStress = result.failureAnalysis ? result.failureAnalysis.maxStress : result.maxStress;
        stressValue.textContent = `${maxStress.toFixed(1)} MPa`;
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
                thicknessSlider.value = numValue;
                thicknessValue.textContent = numValue.toFixed(1) + ' cm';
                this.viewer.createTable(numValue);
                return true;
            }
            return false;
        });
    }
    
    makeValueEditable(span, slider, onUpdate) {
        span.addEventListener('click', () => {
            if (span.classList.contains('editing')) return;
            
            const originalText = span.textContent;
            const originalValue = parseFloat(originalText);
            
            span.classList.add('editing');
            span.contentEditable = true;
            span.textContent = originalValue; // Enlever unités
            span.focus();
            
            // Sélectionner tout le texte
            const range = document.createRange();
            range.selectNodeContents(span);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            
            const finish = (save) => {
                span.contentEditable = false;
                span.classList.remove('editing');
                
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
            
            span.addEventListener('blur', () => finish(true), { once: true });
            span.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finish(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(false);
                }
            }, { once: true });
        });
    }
}

// Initialiser l'application au chargement
document.addEventListener('DOMContentLoaded', () => {
    window.app = new BackpackSimulatorApp();
});
