// Moteur de simulation physique V3 - Mécanique de flexion réelle
// Basé sur la théorie des poutres en porte-à-faux (cantilever)

class AdvancedPhysicsEngineV3 {
    constructor() {
        // Propriétés du matériau PLA
        this.material = {
            name: 'PLA',
            yieldStrength: 50, // MPa (résistance à la traction)
            density: 1.25, // g/cm³
            elasticModulus: 3500, // MPa (module d'Young)
            poissonRatio: 0.36,
            ultimateStrength: 60 // MPa (rupture)
        };

        this.gravity = 9.81; // m/s²
        this.tableThickness = 2.1; // cm
    }

    /**
     * Simulation principale
     */
    simulateWithHangingPoint(geometry, meshPosition, meshRotation, hangingPoint, weight) {
        console.log('🔬 === SIMULATION V3 - MÉCANIQUE DE FLEXION RÉELLE ===');
        console.log('Point d\'accrochage:', hangingPoint);
        console.log('Poids:', weight, 'kg');

        // 1. Extraire tous les vertices transformés
        const vertices = this.extractVertices(geometry, meshPosition, meshRotation);
        
        // 2. Analyser la géométrie : trouver l'encastrement et la direction de flexion
        const structureAnalysis = this.analyzeStructure(vertices, hangingPoint);
        
        // 3. Calculer les contraintes avec la vraie mécanique de flexion
        const stressAnalysis = this.calculateBendingStress(
            vertices, 
            structureAnalysis, 
            hangingPoint, 
            weight
        );
        
        // 4. Déterminer si ça casse
        const failureAnalysis = this.analyzeFailure(stressAnalysis, weight);
        
        console.log('✅ Simulation V3 terminée');
        
        return {
            vertices: vertices,
            structureAnalysis: structureAnalysis,
            stressAnalysis: stressAnalysis,
            failureAnalysis: failureAnalysis,
            maxWeight: failureAnalysis.maxSafeWeight,
            safety: failureAnalysis.safety
        };
    }

    /**
     * Extraire et transformer tous les vertices
     */
    extractVertices(geometry, meshPosition, meshRotation) {
        const positions = geometry.attributes.position;
        const vertices = [];
        
        for (let i = 0; i < positions.count; i++) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            
            v.multiplyScalar(0.1);
            v.applyEuler(meshRotation);
            v.add(meshPosition);
            
            vertices.push({
                position: v,
                index: i
            });
        }
        
        return vertices;
    }

    /**
     * Analyser la structure pour comprendre comment elle va fléchir
     */
    analyzeStructure(vertices, hangingPoint) {
        console.log('📐 Analyse de la structure...');
        
        // Séparer vertices dans/hors table
        const anchorVertices = [];
        const freeVertices = [];
        
        vertices.forEach(v => {
            if (v.position.y <= this.tableThickness + 0.5) {
                anchorVertices.push(v);
            } else {
                freeVertices.push(v);
            }
        });
        
        // Centre de l'ancrage (dans la table)
        const anchorCenter = new THREE.Vector3();
        if (anchorVertices.length > 0) {
            anchorVertices.forEach(v => anchorCenter.add(v.position));
            anchorCenter.divideScalar(anchorVertices.length);
        }
        
        // Point de sortie de table (l'encastrement)
        const exitY = this.tableThickness;
        const exitVertices = freeVertices.filter(v => 
            v.position.y >= exitY && v.position.y <= exitY + 2
        );
        
        const exitCenter = new THREE.Vector3();
        if (exitVertices.length > 0) {
            exitVertices.forEach(v => exitCenter.add(v.position));
            exitCenter.divideScalar(exitVertices.length);
        } else {
            exitCenter.set(anchorCenter.x, exitY, anchorCenter.z);
        }
        
        // DIRECTION DE FLEXION : du point d'accrochage vers l'ancrage
        // C'est la direction dans laquelle le support va plier
        const bendDirection = new THREE.Vector3()
            .subVectors(anchorCenter, hangingPoint)
            .setY(0) // On ne garde que la composante horizontale
            .normalize();
        
        // Si le vecteur est nul (point d'accrochage au-dessus de l'ancrage), utiliser Z
        if (bendDirection.length() < 0.1) {
            bendDirection.set(0, 0, -1);
        }
        
        console.log('  Direction de flexion:', bendDirection.x.toFixed(2), bendDirection.z.toFixed(2));
        
        // Calculer le bras de levier (distance horizontale)
        const leverArm = Math.sqrt(
            Math.pow(hangingPoint.x - exitCenter.x, 2) +
            Math.pow(hangingPoint.z - exitCenter.z, 2)
        );
        
        // Trouver les limites de la structure hors table
        let bounds = {
            xMin: Infinity, xMax: -Infinity,
            yMin: Infinity, yMax: -Infinity,
            zMin: Infinity, zMax: -Infinity
        };
        
        freeVertices.forEach(v => {
            bounds.xMin = Math.min(bounds.xMin, v.position.x);
            bounds.xMax = Math.max(bounds.xMax, v.position.x);
            bounds.yMin = Math.min(bounds.yMin, v.position.y);
            bounds.yMax = Math.max(bounds.yMax, v.position.y);
            bounds.zMin = Math.min(bounds.zMin, v.position.z);
            bounds.zMax = Math.max(bounds.zMax, v.position.z);
        });
        
        console.log('  Ancrage:', anchorCenter.x.toFixed(1), anchorCenter.y.toFixed(1), anchorCenter.z.toFixed(1));
        console.log('  Sortie table:', exitCenter.x.toFixed(1), exitCenter.y.toFixed(1), exitCenter.z.toFixed(1));
        console.log('  Bras de levier:', leverArm.toFixed(1), 'cm');
        
        return {
            anchorVertices,
            freeVertices,
            anchorCenter,
            exitCenter,
            exitY,
            leverArm,
            bendDirection,
            bounds
        };
    }

    /**
     * Calculer les contraintes de flexion pour chaque vertex
     * 
     * PRINCIPE PHYSIQUE :
     * - Le sac tire vers le bas → crée un moment M = F × d
     * - Ce moment fait fléchir le support
     * - Le côté ARRIÈRE (vers la table) est en TENSION (fibres étirées)
     * - Le côté AVANT (vers le sac) est en COMPRESSION
     * - La contrainte est maximale aux fibres les plus éloignées de l'axe neutre
     * - σ = M × y / I où y = distance à l'axe neutre
     */
    calculateBendingStress(vertices, structure, hangingPoint, weight) {
        console.log('📊 Calcul des contraintes de flexion...');
        
        const force = weight * this.gravity; // N
        const stressMap = [];
        
        // Force et moment
        const leverArmM = structure.leverArm / 100; // en mètres
        const maxMoment = force * leverArmM; // N⋅m à l'encastrement
        
        console.log('  Force:', force.toFixed(1), 'N');
        console.log('  Bras de levier:', (leverArmM * 100).toFixed(1), 'cm');
        console.log('  Moment à l\'encastrement:', maxMoment.toFixed(2), 'N⋅m');
        
        // Pour chaque vertex
        vertices.forEach(v => {
            const pos = v.position;
            
            // Zone d'ancrage (dans la table) = pas de contrainte
            if (pos.y <= this.tableThickness + 0.2) {
                stressMap.push({
                    vertex: v,
                    stress: 0,
                    inAnchorZone: true
                });
                return;
            }
            
            // === CALCUL DE LA CONTRAINTE DE FLEXION ===
            
            // 1. Distance horizontale entre ce vertex et le point d'accrochage
            //    Le moment diminue linéairement vers le point d'application
            const distToHangPoint = Math.sqrt(
                Math.pow(pos.x - hangingPoint.x, 2) +
                Math.pow(pos.z - hangingPoint.z, 2)
            );
            
            // 2. Distance horizontale entre ce vertex et l'ancrage
            const distToAnchor = Math.sqrt(
                Math.pow(pos.x - structure.anchorCenter.x, 2) +
                Math.pow(pos.z - structure.anchorCenter.z, 2)
            );
            
            // 3. Moment local : proportionnel à la distance vers le point d'accrochage
            //    M(x) = F × distance_au_point_accrochage
            const localMoment = force * (distToHangPoint / 100); // N⋅m
            
            // 4. POSITION PAR RAPPORT À L'AXE NEUTRE
            //    L'axe neutre est la ligne entre l'ancrage et le point d'accrochage
            //    Les vertices du côté ARRIÈRE (vers la table) sont en TENSION
            //    Les vertices du côté AVANT sont en compression
            
            // Vecteur du vertex vers l'axe (ancrage -> point d'accrochage)
            const axisDir = new THREE.Vector3()
                .subVectors(hangingPoint, structure.anchorCenter)
                .setY(0)
                .normalize();
            
            // Vecteur perpendiculaire (vers l'arrière = côté tension)
            const perpDir = new THREE.Vector3(-axisDir.z, 0, axisDir.x);
            
            // Position du vertex par rapport à l'axe neutre
            const vertexToAnchor = new THREE.Vector3()
                .subVectors(pos, structure.anchorCenter)
                .setY(0);
            
            // Distance signée à l'axe neutre (positif = côté tension/arrière)
            const distToNeutralAxis = vertexToAnchor.dot(perpDir);
            
            // 5. Estimer l'épaisseur locale (pour le moment d'inertie)
            const localThickness = this.estimateLocalThickness(pos, vertices, perpDir);
            
            // 6. Calcul de la contrainte σ = M × y / I
            //    I = b × h³ / 12 pour section rectangulaire
            //    y = distance à l'axe neutre
            const b = Math.max(localThickness.width, 0.5) / 100; // m
            const h = Math.max(localThickness.height, 0.5) / 100; // m
            const I = (b * Math.pow(h, 3)) / 12;
            
            // Distance à l'axe neutre (en mètres), normalisée par la demi-épaisseur
            const halfHeight = h / 2;
            const yNorm = Math.abs(distToNeutralAxis / 100) / halfHeight;
            const y = Math.min(yNorm, 1.0) * halfHeight; // Clamper à la surface
            
            let baseStress = I > 0 ? (localMoment * y / I) / 1e6 : 0; // MPa
            
            // 7. FACTEURS DE CONCENTRATION DE CONTRAINTES
            let stressMultiplier = 1.0;
            
            // 7a. CÔTÉ TENSION vs COMPRESSION
            //     Le côté tension (arrière) a la contrainte maximale
            //     Le côté compression est moins critique
            if (distToNeutralAxis > 0) {
                // Côté tension (arrière) - contrainte maximale
                stressMultiplier *= 1.0 + (distToNeutralAxis / 5) * 0.5;
            } else {
                // Côté compression (avant) - moins critique
                stressMultiplier *= 0.3;
            }
            
            // 7b. PROXIMITÉ DE L'ENCASTREMENT
            //     La contrainte est maximale à la sortie de table
            const distFromExit = pos.y - structure.exitY;
            if (distFromExit >= 0 && distFromExit <= 5) {
                // Zone critique : 0-5 cm au-dessus de la table
                const exitFactor = 2.5 - (distFromExit / 5) * 1.5; // 2.5 → 1.0
                stressMultiplier *= exitFactor;
            }
            
            // 7c. PROXIMITÉ DE L'ANCRAGE (horizontalement)
            //     Plus on est proche de l'ancrage, plus le moment est grand
            const totalDist = distToHangPoint + distToAnchor;
            if (totalDist > 0) {
                const anchorProximity = distToHangPoint / totalDist; // 0 = au point d'accrochage, 1 = à l'ancrage
                stressMultiplier *= 0.5 + anchorProximity * 1.5; // 0.5 → 2.0
            }
            
            // 7d. JONCTIONS / ANGLES
            //     Détecter si on est près d'un changement de géométrie
            const isNearJunction = this.isNearGeometryChange(pos, vertices, structure);
            if (isNearJunction) {
                stressMultiplier *= 2.0; // Facteur de concentration aux angles
            }
            
            // Contrainte finale
            const finalStress = baseStress * stressMultiplier;
            
            stressMap.push({
                vertex: v,
                stress: finalStress,
                inAnchorZone: false,
                baseStress: baseStress,
                stressMultiplier: stressMultiplier,
                distToNeutralAxis: distToNeutralAxis,
                distFromExit: distFromExit,
                localMoment: localMoment,
                isTensionSide: distToNeutralAxis > 0
            });
        });
        
        // Trouver le maximum
        let maxStress = 0;
        let maxStressVertex = null;
        
        stressMap.forEach(sm => {
            if (sm.stress > maxStress && !sm.inAnchorZone) {
                maxStress = sm.stress;
                maxStressVertex = sm.vertex;
            }
        });
        
        // Log des stats
        const tensionVertices = stressMap.filter(sm => sm.isTensionSide && !sm.inAnchorZone);
        const avgTensionStress = tensionVertices.reduce((sum, sm) => sum + sm.stress, 0) / tensionVertices.length;
        
        console.log('  Contrainte max:', maxStress.toFixed(2), 'MPa');
        console.log('  Contrainte moyenne (tension):', avgTensionStress.toFixed(2), 'MPa');
        if (maxStressVertex) {
            console.log('  Position critique:', 
                maxStressVertex.position.x.toFixed(1),
                maxStressVertex.position.y.toFixed(1),
                maxStressVertex.position.z.toFixed(1)
            );
        }
        
        return {
            stressMap: stressMap,
            maxStress: maxStress,
            maxStressVertex: maxStressVertex,
            criticalPoint: maxStressVertex ? maxStressVertex.position : structure.exitCenter
        };
    }

    /**
     * Estimer l'épaisseur locale du support
     */
    estimateLocalThickness(pos, vertices, perpDir) {
        const searchRadius = 3; // cm
        
        // Trouver les vertices proches dans le plan horizontal
        const neighbors = vertices.filter(v => {
            const dy = Math.abs(v.position.y - pos.y);
            const dx = Math.abs(v.position.x - pos.x);
            const dz = Math.abs(v.position.z - pos.z);
            return dy < 1 && (dx < searchRadius || dz < searchRadius);
        });
        
        if (neighbors.length < 3) {
            return { width: 1, height: 1 };
        }
        
        // Calculer l'étendue dans la direction perpendiculaire (épaisseur)
        let minPerp = Infinity, maxPerp = -Infinity;
        let minPara = Infinity, maxPara = -Infinity;
        
        neighbors.forEach(v => {
            const rel = new THREE.Vector3().subVectors(v.position, pos);
            const perpDist = rel.x * perpDir.x + rel.z * perpDir.z;
            const paraDist = rel.x * (-perpDir.z) + rel.z * perpDir.x;
            
            minPerp = Math.min(minPerp, perpDist);
            maxPerp = Math.max(maxPerp, perpDist);
            minPara = Math.min(minPara, paraDist);
            maxPara = Math.max(maxPara, paraDist);
        });
        
        return {
            height: Math.max(maxPerp - minPerp, 0.5), // Épaisseur dans la direction de flexion
            width: Math.max(maxPara - minPara, 0.5)   // Largeur perpendiculaire
        };
    }

    /**
     * Détecter si un vertex est près d'un changement de géométrie (jonction)
     */
    isNearGeometryChange(pos, vertices, structure) {
        // Méthode : comparer la densité de vertices au-dessus et en-dessous
        const checkRadius = 2;
        const checkHeight = 2;
        
        // Vertices au-dessus
        const above = vertices.filter(v => 
            v.position.y > pos.y && 
            v.position.y < pos.y + checkHeight &&
            Math.abs(v.position.x - pos.x) < checkRadius &&
            Math.abs(v.position.z - pos.z) < checkRadius
        );
        
        // Vertices en-dessous
        const below = vertices.filter(v => 
            v.position.y < pos.y && 
            v.position.y > pos.y - checkHeight &&
            Math.abs(v.position.x - pos.x) < checkRadius &&
            Math.abs(v.position.z - pos.z) < checkRadius
        );
        
        // Vertices au même niveau mais décalés horizontalement
        const sameLevel = vertices.filter(v => 
            Math.abs(v.position.y - pos.y) < 1 &&
            (Math.abs(v.position.x - pos.x) > checkRadius || 
             Math.abs(v.position.z - pos.z) > checkRadius)
        );
        
        // Si grande différence de densité = jonction
        const densityRatio = above.length > 0 && below.length > 0 
            ? Math.max(above.length, below.length) / Math.min(above.length, below.length)
            : 1;
        
        // Près de la sortie de table ET différence de géométrie
        const nearExit = pos.y < structure.exitY + 5;
        
        return (densityRatio > 2 && nearExit) || (nearExit && sameLevel.length > above.length * 2);
    }

    /**
     * Analyser si le support va casser
     */
    analyzeFailure(stressAnalysis, currentWeight) {
        const maxStress = stressAnalysis.maxStress;
        const yieldStrength = this.material.yieldStrength;
        
        // Facteur de sécurité
        const safetyFactor = maxStress > 0 ? yieldStrength / maxStress : 10;
        
        // Poids maximum (plus conservateur)
        let maxSafeWeight;
        if (safetyFactor >= 2) {
            maxSafeWeight = currentWeight * (safetyFactor / 2);
        } else {
            maxSafeWeight = currentWeight * safetyFactor * 0.5;
        }
        
        // Plafonner de manière réaliste
        maxSafeWeight = Math.min(maxSafeWeight, 15);
        
        // Verdict
        let safety, message;
        if (safetyFactor >= 2.5) {
            safety = 'safe';
            message = 'Le support devrait tenir.';
        } else if (safetyFactor >= 1.5) {
            safety = 'warning';
            message = 'Support fragile, risque de casse.';
        } else if (safetyFactor >= 1.0) {
            safety = 'danger';
            message = 'Très fragile, va probablement casser !';
        } else {
            safety = 'failure';
            message = 'Le support va casser !';
        }
        
        console.log('📋 Analyse rupture:');
        console.log('  Contrainte max:', maxStress.toFixed(2), 'MPa');
        console.log('  Limite PLA:', yieldStrength, 'MPa');
        console.log('  Facteur sécurité:', safetyFactor.toFixed(2));
        console.log('  Poids max estimé:', maxSafeWeight.toFixed(1), 'kg');
        console.log('  Verdict:', safety);
        
        return {
            safetyFactor: safetyFactor,
            maxSafeWeight: maxSafeWeight,
            safety: safety,
            message: message,
            failurePoint: stressAnalysis.criticalPoint,
            maxStress: maxStress
        };
    }
}

// Export
window.AdvancedPhysicsEngineV3 = AdvancedPhysicsEngineV3;
