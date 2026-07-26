/**
 * Simulateur physique SIMPLIFIÉ et RÉALISTE
 * Analyse statique d'équilibre au lieu de simulation temps réel
 */

class PhysicsSimulator {
    constructor() {
        this.gravity = 9.81; // m/s²
        this.isRunning = false;
        this.animationProgress = 0;
        this.animationDuration = 2.0; // 2 secondes
    }
    
    /**
     * Démarrer l'analyse et l'animation
     */
    startSimulation(mesh, hangingPoint, weight, tableThickness, anchorData) {
        this.mesh = mesh;
        this.hangingPoint = hangingPoint;
        this.weight = weight;
        this.tableThickness = tableThickness;
        this.anchorData = anchorData;
        
        console.log('🎬 Analyse d\'équilibre statique');
        console.log('Poids:', weight, 'kg');
        console.log('Point accrochage:', hangingPoint);
        console.log('Zone insérée:', anchorData.insertedZone);
        
        // Sauvegarder état initial
        this.initialRotation = mesh.rotation.clone();
        
        // ÉTAPE 1 : Analyser l'équilibre
        const equilibriumAnalysis = this.analyzeEquilibrium();
        
        console.log('⚖️ Analyse d\'équilibre:', equilibriumAnalysis);
        
        // ÉTAPE 2 : Décider de l'animation
        if (equilibriumAnalysis.isStable) {
            // STABLE : petite oscillation puis arrêt
            this.animateStable(equilibriumAnalysis);
        } else {
            // INSTABLE : animation de chute
            this.animateFalling(equilibriumAnalysis);
        }
    }
    
    /**
     * Analyser l'équilibre statique
     */
    analyzeEquilibrium() {
        console.log('🔍 === DÉBUT ANALYSE ÉQUILIBRE ===');
        
        const geometry = this.mesh.geometry;
        const positions = geometry.attributes.position;
        
        // 1. Calculer le centre de masse de la structure
        let centerOfMass = new THREE.Vector3(0, 0, 0);
        let totalVolume = 0;
        
        for (let i = 0; i < positions.count; i += 10) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            v.multiplyScalar(0.1);
            v.applyEuler(this.mesh.rotation);
            v.add(this.mesh.position);
            
            centerOfMass.add(v);
            totalVolume++;
        }
        centerOfMass.divideScalar(totalVolume);
        
        console.log('📍 Centre de masse structure:', {
            x: centerOfMass.x.toFixed(2),
            y: centerOfMass.y.toFixed(2),
            z: centerOfMass.z.toFixed(2)
        });
        
        // 2. Centre de masse combiné avec le sac
        const sacWeight = this.weight;
        const structureWeight = 0.2;
        
        const combinedCenterOfMass = new THREE.Vector3(
            (centerOfMass.x * structureWeight + this.hangingPoint.x * sacWeight) / (structureWeight + sacWeight),
            (centerOfMass.y * structureWeight + this.hangingPoint.y * sacWeight) / (structureWeight + sacWeight),
            (centerOfMass.z * structureWeight + this.hangingPoint.z * sacWeight) / (structureWeight + sacWeight)
        );
        
        console.log('📍 Point accrochage:', {
            x: this.hangingPoint.x.toFixed(2),
            y: this.hangingPoint.y.toFixed(2),
            z: this.hangingPoint.z.toFixed(2)
        });
        
        console.log('📍 Centre de masse combiné:', {
            x: combinedCenterOfMass.x.toFixed(2),
            y: combinedCenterOfMass.y.toFixed(2),
            z: combinedCenterOfMass.z.toFixed(2)
        });
        
        // 3. Zone insérée
        const insertedZone = this.anchorData.insertedZone;
        console.log('📦 Zone insérée:', {
            xMin: insertedZone.xMin.toFixed(2),
            xMax: insertedZone.xMax.toFixed(2),
            zMin: insertedZone.zMin.toFixed(2),
            zMax: insertedZone.zMax.toFixed(2),
            centerX: insertedZone.center.x.toFixed(2),
            centerZ: insertedZone.center.z.toFixed(2)
        });
        
        // 4. Trouver le bord pivot
        const centerInserted = new THREE.Vector3(
            insertedZone.center.x,
            this.tableThickness,
            insertedZone.center.z
        );
        
        const edges = [
            { name: 'avant', axis: 'z', value: insertedZone.zMin, normal: new THREE.Vector3(0, 0, -1) },
            { name: 'arrière', axis: 'z', value: insertedZone.zMax, normal: new THREE.Vector3(0, 0, 1) },
            { name: 'gauche', axis: 'x', value: insertedZone.xMin, normal: new THREE.Vector3(-1, 0, 0) },
            { name: 'droit', axis: 'x', value: insertedZone.xMax, normal: new THREE.Vector3(1, 0, 0) }
        ];
        
        const directionToCoM = new THREE.Vector3()
            .subVectors(combinedCenterOfMass, centerInserted)
            .normalize();
        
        console.log('➡️ Direction vers centre de masse:', {
            x: directionToCoM.x.toFixed(3),
            y: directionToCoM.y.toFixed(3),
            z: directionToCoM.z.toFixed(3)
        });
        
        let pivotEdge = edges[0];
        let maxDot = -Infinity;
        
        console.log('🔍 Test des bords:');
        edges.forEach(edge => {
            const dot = directionToCoM.dot(edge.normal);
            console.log(`  ${edge.name}: dot=${dot.toFixed(3)}`);
            if (dot > maxDot) {
                maxDot = dot;
                pivotEdge = edge;
            }
        });
        
        console.log('✅ Bord pivot sélectionné:', pivotEdge.name, '(' + pivotEdge.axis + '=' + pivotEdge.value.toFixed(2) + ')');
        
        // 5. Point de pivot et axe de rotation
        let pivotPoint, rotationAxis;
        
        if (pivotEdge.axis === 'z') {
            pivotPoint = new THREE.Vector3(centerInserted.x, this.tableThickness, pivotEdge.value);
            rotationAxis = new THREE.Vector3(1, 0, 0);
        } else {
            pivotPoint = new THREE.Vector3(pivotEdge.value, this.tableThickness, centerInserted.z);
            rotationAxis = new THREE.Vector3(0, 0, 1);
        }
        
        console.log('📍 Point de pivot:', {
            x: pivotPoint.x.toFixed(2),
            y: pivotPoint.y.toFixed(2),
            z: pivotPoint.z.toFixed(2)
        });
        console.log('🔄 Axe de rotation:', rotationAxis);
        
        // 6. Calcul du moment
        const leverArm = new THREE.Vector3().subVectors(combinedCenterOfMass, pivotPoint);
        
        console.log('📏 Bras de levier brut:', {
            x: leverArm.x.toFixed(2),
            y: leverArm.y.toFixed(2),
            z: leverArm.z.toFixed(2),
            length: leverArm.length().toFixed(2)
        });
        
        const perpendicular = new THREE.Vector3()
            .copy(leverArm)
            .sub(rotationAxis.clone().multiplyScalar(leverArm.dot(rotationAxis)));
        
        console.log('📏 Bras perpendiculaire:', {
            x: perpendicular.x.toFixed(2),
            y: perpendicular.y.toFixed(2),
            z: perpendicular.z.toFixed(2),
            length: perpendicular.length().toFixed(2)
        });
        
        const leverLength = perpendicular.length() / 100; // en m
        
        const gravity = new THREE.Vector3(0, -1, 0);
        const torqueDirection = new THREE.Vector3().crossVectors(perpendicular, gravity);
        const rotationSign = Math.sign(torqueDirection.dot(rotationAxis));
        
        const totalWeight = structureWeight + sacWeight;
        const moment = totalWeight * this.gravity * leverLength * Math.abs(rotationSign);
        
        console.log('⚖️ RÉSULTAT:');
        console.log('  Bras de levier:', (leverLength * 100).toFixed(2), 'cm');
        console.log('  Poids total:', totalWeight.toFixed(2), 'kg');
        console.log('  Moment:', moment.toFixed(3), 'N⋅m');
        console.log('  Sens rotation:', rotationSign > 0 ? '+' : '-');
        
        // 7. Stabilité - SEUIL RÉALISTE
        const stabilityThreshold = 0.3; // N⋅m - abaissé pour être plus sensible
        const isStable = moment < stabilityThreshold;
        
        console.log('🎯 Seuil de stabilité:', stabilityThreshold, 'N⋅m');
        console.log('🎯 STABLE?', isStable ? '✅ OUI' : '❌ NON');
        
        // 8. Angle de basculement
        let targetAngle = 0;
        if (!isStable) {
            const maxAngle = Math.PI / 2;
            const angleRatio = Math.min(1, moment / 3); // Normalisation sur 3 N⋅m
            targetAngle = angleRatio * maxAngle * rotationSign;
            console.log('📐 Angle cible:', (targetAngle * 180 / Math.PI).toFixed(1), '°');
        }
        
        console.log('🔍 === FIN ANALYSE ===');
        
        return {
            isStable: isStable,
            centerOfMass: combinedCenterOfMass,
            pivotPoint: pivotPoint,
            rotationAxis: rotationAxis,
            moment: moment,
            targetAngle: targetAngle,
            rotationSign: rotationSign
        };
    }
    
    /**
     * Animation pour support STABLE
     */
    animateStable(analysis) {
        console.log('✅ Support STABLE - Petite oscillation');
        
        this.isRunning = true;
        this.animationProgress = 0;
        const oscillationAmplitude = 0.03; // ~2 degrés
        
        // Sauvegarder la position initiale
        this.initialPosition = this.mesh.position.clone();
        
        const animate = () => {
            if (!this.isRunning) return;
            
            this.animationProgress += 1/60 / this.animationDuration;
            
            if (this.animationProgress >= 1.0) {
                this.isRunning = false;
                
                // Restaurer position et rotation
                this.mesh.position.copy(this.initialPosition);
                this.mesh.rotation.copy(this.initialRotation);
                
                this.finish({
                    isStable: true,
                    hasFallen: false,
                    message: '✅ Support STABLE - tient par appui sur la table',
                    analysis: analysis
                });
                return;
            }
            
            // Oscillation amortie
            const t = this.animationProgress;
            const oscillation = Math.sin(t * Math.PI * 3) * Math.exp(-t * 4);
            const angle = oscillation * oscillationAmplitude * analysis.rotationSign;
            
            // ROTATION AUTOUR DU PIVOT
            this.mesh.position.copy(this.initialPosition);
            this.mesh.rotation.copy(this.initialRotation);
            
            this.mesh.position.sub(analysis.pivotPoint);
            
            const axis = analysis.rotationAxis.clone().normalize();
            const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
            this.mesh.position.applyQuaternion(quaternion);
            this.mesh.quaternion.multiplyQuaternions(quaternion, this.mesh.quaternion);
            
            this.mesh.position.add(analysis.pivotPoint);
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    /**
     * Animation pour support INSTABLE avec rotation autour du pivot
     */
    animateFalling(analysis) {
        console.log('❌ Support INSTABLE - Animation de chute réaliste');
        console.log('Rotation autour de:', analysis.pivotPoint);
        console.log('Axe:', analysis.rotationAxis);
        console.log('Angle cible:', (analysis.targetAngle * 180 / Math.PI).toFixed(1), '°');
        
        this.isRunning = true;
        this.animationProgress = 0;
        this.hasCollided = false;
        
        // Sauvegarder la position initiale
        this.initialPosition = this.mesh.position.clone();
        
        const animate = () => {
            if (!this.isRunning) return;
            
            this.animationProgress += 1/60 / this.animationDuration;
            
            // Easing out cubic
            const t = Math.min(this.animationProgress, 1.0);
            const eased = 1 - Math.pow(1 - t, 3);
            
            // Angle actuel
            const currentAngle = eased * analysis.targetAngle;
            
            // ROTATION AUTOUR D'UN POINT EXTERNE
            // 1. Restaurer position/rotation initiale
            this.mesh.position.copy(this.initialPosition);
            this.mesh.rotation.copy(this.initialRotation);
            
            // 2. Translater pour mettre le pivot à l'origine
            this.mesh.position.sub(analysis.pivotPoint);
            
            // 3. Appliquer la rotation
            const axis = analysis.rotationAxis.clone().normalize();
            const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, currentAngle);
            this.mesh.position.applyQuaternion(quaternion);
            this.mesh.quaternion.multiplyQuaternions(quaternion, this.mesh.quaternion);
            
            // 4. Translater de retour
            this.mesh.position.add(analysis.pivotPoint);
            
            // DÉTECTION DE COLLISION
            const collision = this.checkTableCollision();
            
            if (collision && !this.hasCollided) {
                console.log('💥 Collision avec la table détectée à angle:', (currentAngle * 180 / Math.PI).toFixed(1), '°');
                this.hasCollided = true;
                this.isRunning = false;
                
                this.finish({
                    isStable: false,
                    hasFallen: true,
                    message: '❌ Support TOMBÉ - heurte la table',
                    analysis: analysis
                });
                return;
            }
            
            if (this.animationProgress >= 1.0) {
                this.isRunning = false;
                
                this.finish({
                    isStable: false,
                    hasFallen: true,
                    message: '❌ Support TOMBÉ - conception inadaptée',
                    analysis: analysis
                });
                return;
            }
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    /**
     * Vérifier collision avec la table
     */
    checkTableCollision() {
        const geometry = this.mesh.geometry;
        const positions = geometry.attributes.position;
        
        let collisionCount = 0;
        const sampleRate = 20; // Échantillonner 1 vertex sur 20
        
        for (let i = 0; i < positions.count; i += sampleRate) {
            const vertex = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            
            // Transformer en coordonnées monde
            vertex.multiplyScalar(0.1);
            vertex.applyEuler(this.mesh.rotation);
            vertex.add(this.mesh.position);
            
            // Vérifier si vertex traverse la table (Y entre 0 et tableThickness)
            if (vertex.y >= 0 && vertex.y <= this.tableThickness) {
                // Vérifier si c'est dans les limites XZ de la table
                if (Math.abs(vertex.x) < 80 && Math.abs(vertex.z) < 80) {
                    collisionCount++;
                    if (collisionCount > 5) return true; // Collision confirmée
                }
            }
            
            // Vérifier aussi si vertex passe sous la table
            if (vertex.y < -0.5) {
                collisionCount++;
                if (collisionCount > 5) return true;
            }
        }
        
        return false;
    }
    
    /**
     * Terminer la simulation
     */
    finish(result) {
        console.log('🏁 Simulation terminée');
        console.log('Résultat:', result);
        
        if (this.onStabilizedCallback) {
            this.onStabilizedCallback(result);
        }
    }
    
    /**
     * Arrêter et restaurer
     */
    stopSimulation() {
        this.isRunning = false;
        
        if (this.mesh) {
            if (this.initialPosition) {
                this.mesh.position.copy(this.initialPosition);
            }
            if (this.initialRotation) {
                this.mesh.rotation.copy(this.initialRotation);
            }
        }
        
        console.log('⏹️ Simulation arrêtée et restaurée');
    }
}
