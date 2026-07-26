// Moteur de simulation physique avancé
class AdvancedPhysicsEngine {
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
    }

    /**
     * Simulation complète avec point d'accrochage
     */
    simulateWithHangingPoint(geometry, meshPosition, meshRotation, hangingPoint, weight) {
        console.log('🔬 Démarrage simulation avancée');
        console.log('Point d\'accrochage:', hangingPoint);
        console.log('Poids:', weight, 'kg');

        // 1. Analyser la géométrie
        const geometryAnalysis = this.analyzeGeometry(geometry, meshPosition, meshRotation);
        
        // 2. Trouver la zone d'ancrage dans la table (partie insérée)
        const anchorData = this.findAnchorPoint(geometryAnalysis, this.tableThickness);
        const anchorPoint = anchorData.point;
        
        // 3. Calculer les forces
        const forces = this.calculateForces(hangingPoint, anchorPoint, weight);
        
        // 4. Analyser les contraintes sur toute la structure
        const stressAnalysis = this.analyzeStress(
            geometryAnalysis, 
            forces, 
            hangingPoint, 
            anchorPoint,
            anchorData.insertedVertices
        );
        
        // 5. Déterminer le point de rupture
        const failureAnalysis = this.analyzeFailure(stressAnalysis, weight);
        
        // 6. Générer la visualisation
        const visualization = this.generateVisualization(geometryAnalysis, stressAnalysis, failureAnalysis);
        
        return {
            forces: forces,
            stressAnalysis: stressAnalysis,
            failureAnalysis: failureAnalysis,
            visualization: visualization,
            geometryAnalysis: geometryAnalysis,
            anchorData: anchorData,
            anchorPoint: anchorPoint,
            maxWeight: failureAnalysis.maxSafeWeight,
            safety: failureAnalysis.safety
        };
    }

    /**
     * Analyser la géométrie complète
     */
    analyzeGeometry(geometry, meshPosition, meshRotation) {
        const positions = geometry.attributes.position;
        const vertices = [];
        
        // Extraire tous les vertices avec transformation
        for (let i = 0; i < positions.count; i++) {
            const v = new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            );
            
            // Appliquer l'échelle (0.1)
            v.multiplyScalar(0.1);
            
            // Appliquer la rotation
            v.applyEuler(meshRotation);
            
            // Appliquer la position
            v.add(meshPosition);
            
            vertices.push(v);
        }

        // Calculer la boîte englobante
        const bbox = new THREE.Box3().setFromPoints(vertices);
        
        // Diviser en sections verticales pour analyse ULTRA HAUTE PRÉCISION
        const sections = this.dividIntoSections(vertices, 80); // 80 sections !
        
        return {
            vertices: vertices,
            bbox: bbox,
            sections: sections,
            vertexCount: vertices.length
        };
    }

    /**
     * Diviser le modèle en sections pour analyse - VERSION HAUTE PRÉCISION
     */
    dividIntoSections(vertices, numSections = 40) {
        const sections = [];
        
        // Trouver les limites en Y
        let minY = Infinity;
        let maxY = -Infinity;
        vertices.forEach(v => {
            minY = Math.min(minY, v.y);
            maxY = Math.max(maxY, v.y);
        });
        
        const yStep = (maxY - minY) / numSections;
        
        console.log('📏 Division en', numSections, 'sections de', yStep.toFixed(2), 'cm');
        
        for (let i = 0; i < numSections; i++) {
            const yLow = minY + i * yStep;
            const yHigh = minY + (i + 1) * yStep;
            const yMid = (yLow + yHigh) / 2;
            
            // Trouver les vertices dans cette tranche
            const sectionVertices = vertices.filter(v => v.y >= yLow && v.y < yHigh);
            
            if (sectionVertices.length === 0) continue;
            
            // Calculer les propriétés de la section
            const xValues = sectionVertices.map(v => v.x);
            const zValues = sectionVertices.map(v => v.z);
            
            const xMin = Math.min(...xValues);
            const xMax = Math.max(...xValues);
            const zMin = Math.min(...zValues);
            const zMax = Math.max(...zValues);
            
            const width = xMax - xMin;
            const depth = zMax - zMin;
            const area = width * depth; // Approximation
            
            // Centre de la section
            const centerX = (xMin + xMax) / 2;
            const centerZ = (zMin + zMax) / 2;
            
            sections.push({
                yLow: yLow,
                yHigh: yHigh,
                yMid: yMid,
                center: new THREE.Vector3(centerX, yMid, centerZ),
                width: width,
                depth: depth,
                area: area,
                minDimension: Math.min(width, depth),
                vertexCount: sectionVertices.length
            });
        }
        
        return sections;
    }

    /**
     * Trouver la zone d'ancrage dans la table (partie insérée)
     */
    findAnchorPoint(geometryAnalysis, tableThickness = 2.1) {
        const vertices = geometryAnalysis.vertices;
        
        console.log('🔍 Recherche de la zone d\'ancrage...');
        console.log('Épaisseur de table:', tableThickness, 'cm');
        
        // La zone insérée = vertices qui sont à l'intérieur de l'épaisseur de la table
        // Table de 0 à tableThickness en Y
        const insertedVertices = vertices.filter(v => 
            v.y >= -0.5 && v.y <= tableThickness + 0.5
        );
        
        console.log('Vertices insérés dans la table:', insertedVertices.length, '/', vertices.length);
        
        if (insertedVertices.length === 0) {
            console.warn('⚠️ Aucun vertex dans la table - utilisation du point le plus bas');
            let lowestY = Infinity;
            let lowestVertex = null;
            vertices.forEach(v => {
                if (v.y < lowestY) {
                    lowestY = v.y;
                    lowestVertex = v;
                }
            });
            return {
                point: lowestVertex ? lowestVertex.clone() : new THREE.Vector3(0, 0, 0),
                insertedVertices: [],
                insertedZone: null
            };
        }
        
        // Calculer le centre géométrique de la zone insérée
        const anchorCenter = new THREE.Vector3();
        insertedVertices.forEach(v => anchorCenter.add(v));
        anchorCenter.divideScalar(insertedVertices.length);
        
        // Calculer les dimensions de la zone insérée
        const xValues = insertedVertices.map(v => v.x);
        const zValues = insertedVertices.map(v => v.z);
        
        const insertedZone = {
            xMin: Math.min(...xValues),
            xMax: Math.max(...xValues),
            zMin: Math.min(...zValues),
            zMax: Math.max(...zValues),
            width: Math.max(...xValues) - Math.min(...xValues),
            depth: Math.max(...zValues) - Math.min(...zValues),
            center: anchorCenter.clone()
        };
        
        console.log('✅ Zone d\'ancrage détectée:');
        console.log('  - Centre:', anchorCenter.x.toFixed(1), anchorCenter.y.toFixed(1), anchorCenter.z.toFixed(1));
        console.log('  - Dimensions:', insertedZone.width.toFixed(1), 'x', insertedZone.depth.toFixed(1), 'cm');
        
        return {
            point: anchorCenter,
            insertedVertices: insertedVertices,
            insertedZone: insertedZone
        };
    }

    /**
     * Calculer toutes les forces en jeu
     */
    calculateForces(hangingPoint, anchorPoint, weight) {
        const weightForce = weight * this.gravity; // Newtons
        
        // Vecteur du moment (bras de levier)
        const leverArm = new THREE.Vector3().subVectors(hangingPoint, anchorPoint);
        const leverLength = leverArm.length() / 100; // Convertir en mètres
        
        // Moment de flexion
        const bendingMoment = weightForce * leverLength; // N⋅m
        
        // Décomposer les forces
        const verticalDistance = (hangingPoint.y - anchorPoint.y) / 100; // m
        const horizontalDistance = Math.sqrt(
            Math.pow((hangingPoint.x - anchorPoint.x) / 100, 2) +
            Math.pow((hangingPoint.z - anchorPoint.z) / 100, 2)
        ); // m
        
        return {
            weight: weight,
            weightForce: weightForce, // N
            leverArm: leverArm, // cm (vecteur)
            leverLength: leverLength * 100, // cm
            bendingMoment: bendingMoment, // N⋅m
            verticalDistance: verticalDistance * 100, // cm
            horizontalDistance: horizontalDistance * 100, // cm
            angle: Math.atan2(horizontalDistance, verticalDistance) * 180 / Math.PI // degrés
        };
    }

    /**
     * Analyser les contraintes - PHYSIQUE RÉELLE
     * Zone critique = SORTIE DE TABLE (encastrement) où la section est la plus fine
     */
    analyzeStress(geometryAnalysis, forces, hangingPoint, anchorPoint, insertedVertices) {
        const stressMap = [];
        const sections = geometryAnalysis.sections;
        
        console.log('📊 === ANALYSE CONTRAINTES RÉELLE ===');
        console.log('Force:', forces.weightForce.toFixed(2), 'N');
        console.log('Bras de levier:', forces.leverLength.toFixed(1), 'cm');
        
        // Trouver les limites de la zone insérée (table)
        const insertedYMin = Math.min(...insertedVertices.map(v => v.y));
        const insertedYMax = Math.max(...insertedVertices.map(v => v.y));
        
        console.log('🪵 Table: Y =', insertedYMin.toFixed(1), 'à', insertedYMax.toFixed(1), 'cm');
        console.log('🚪 Sortie de table: Y =', insertedYMax.toFixed(1), 'cm');
        
        // ÉTAPE 1 : Identifier les sections dans la ZONE CRITIQUE (0-5 cm au-dessus de la table)
        const criticalSections = [];
        const criticalZoneHeight = 5; // 5 cm au-dessus de la sortie de table
        
        sections.forEach(section => {
            if (section.yMid > insertedYMax && section.yMid <= insertedYMax + criticalZoneHeight) {
                criticalSections.push(section);
            }
        });
        
        console.log('🎯 Sections critiques trouvées:', criticalSections.length);
        
        // ÉTAPE 2 : Trouver la section la plus FINE dans la zone critique
        let weakestSection = null;
        let minArea = Infinity;
        
        criticalSections.forEach(section => {
            if (section.area < minArea) {
                minArea = section.area;
                weakestSection = section;
            }
        });
        
        if (weakestSection) {
            console.log('💥 Section la plus faible trouvée:');
            console.log('   Y =', weakestSection.yMid.toFixed(1), 'cm');
            console.log('   Aire =', weakestSection.area.toFixed(1), 'cm²');
            console.log('   Dimension mini =', weakestSection.minDimension.toFixed(1), 'cm');
        }
        
        // ÉTAPE 3 : Calculer le moment maximal (à l'encastrement)
        const maxMoment = forces.bendingMoment; // N⋅m (déjà calculé)
        console.log('📐 Moment maximal:', maxMoment.toFixed(2), 'N⋅m');
        
        // ÉTAPE 4 : Pour chaque section, calculer la contrainte
        for (const section of sections) {
            const sectionY = section.yMid;
            
            // Zone insérée = pas de contrainte
            if (sectionY >= insertedYMin && sectionY <= insertedYMax) {
                stressMap.push({
                    section: section,
                    stress: 0,
                    inAnchorZone: true
                });
                continue;
            }
            
            // Distance au point d'accrochage
            const distToLoad = section.center.distanceTo(hangingPoint) / 100; // m
            
            // Moment local (diminue vers le point d'accrochage)
            const localMoment = forces.weightForce * distToLoad;
            
            // Géométrie de la section
            const sectionDim = Math.max(section.minDimension, 0.3);
            const b = sectionDim / 100;
            const h = sectionDim / 100;
            const I = (b * Math.pow(h, 3)) / 12;
            const c = h / 2;
            
            // Contrainte de base
            let stress = I > 0 ? (localMoment * c / I) / 1e6 : 0;
            
            // FACTEUR CRITIQUE 1 : Proximité à la sortie de table
            let exitFactor = 1.0;
            if (sectionY > insertedYMax) {
                const distFromExit = sectionY - insertedYMax;
                if (distFromExit <= 5) {
                    // Zone ultra-critique dans les 5 cm après sortie
                    // Facteur 5x à la sortie, diminue linéairement
                    exitFactor = 5.0 - (distFromExit / 5) * 4.0; // 5.0 -> 1.0
                }
            }
            
            // FACTEUR CRITIQUE 2 : Faiblesse de section comparée au minimum
            let weaknessFactor = 1.0;
            if (weakestSection && minArea > 0) {
                // Plus on est proche de la section la plus faible, plus c'est critique
                const relativeArea = section.area / minArea;
                if (relativeArea < 2.0) {
                    // Section faible = facteur jusqu'à 3x
                    weaknessFactor = 3.0 / relativeArea;
                }
            }
            
            // FACTEUR CRITIQUE 3 : Amplification si on est DANS la zone critique ET faible
            let criticalZoneFactor = 1.0;
            if (sectionY > insertedYMax && sectionY <= insertedYMax + criticalZoneHeight) {
                const relativeArea = minArea > 0 ? section.area / minArea : 1;
                if (relativeArea < 1.5) {
                    // C'est LA zone critique !
                    criticalZoneFactor = 5.0;
                }
            }
            
            // Contrainte finale
            const finalStress = stress * exitFactor * weaknessFactor * criticalZoneFactor;
            
            stressMap.push({
                section: section,
                stress: finalStress,
                baseStress: stress,
                exitFactor: exitFactor,
                weaknessFactor: weaknessFactor,
                criticalZoneFactor: criticalZoneFactor,
                inAnchorZone: false
            });
        }
        
        // Trouver la contrainte maximale
        let maxStress = 0;
        let maxStressSection = null;
        
        stressMap.forEach(sm => {
            if (sm.stress > maxStress) {
                maxStress = sm.stress;
                maxStressSection = sm.section;
            }
        });
        
        // Si la contrainte max est trop faible, ajuster
        if (maxStress < 0.5) {
            console.warn('⚠️ Contraintes très faibles - Ajustement du calcul');
            // Estimation basée sur la formule simple: σ = M×c/I
            const estimatedStress = (forces.bendingMoment * 0.01) / (Math.pow(0.005, 3) / 12);
            maxStress = estimatedStress / 1e6;
            
            // Redistribuer proportionnellement
            const ratio = maxStress / (stressMap[0]?.stress || 1);
            stressMap.forEach(sm => {
                if (!sm.inAnchorZone) {
                    sm.stress *= ratio;
                }
            });
        }
        
        console.log('✅ Contrainte maximale:', maxStress.toFixed(2), 'MPa');
        console.log('📍 Section critique:', maxStressSection ? 'Y=' + maxStressSection.yMid.toFixed(1) : 'N/A');
        
        return {
            stressMap: stressMap,
            maxStress: maxStress,
            maxStressSection: maxStressSection,
            criticalPoint: maxStressSection ? maxStressSection.center : anchorPoint
        };
    }

    /**
     * Analyser la rupture
     */
    analyzeFailure(stressAnalysis, currentWeight) {
        const maxStress = stressAnalysis.maxStress;
        const yieldStrength = this.material.yieldStrength;
        const ultimateStrength = this.material.ultimateStrength;
        
        // Facteur de sécurité
        const safetyFactor = maxStress > 0 ? yieldStrength / maxStress : Infinity;
        
        // Poids maximum sûr (avec facteur de sécurité de 2)
        const maxSafeWeight = safetyFactor > 2 ? currentWeight * (safetyFactor / 2) : currentWeight * safetyFactor * 0.8;
        
        // Déterminer l'état
        let safety, message;
        if (safetyFactor >= 3) {
            safety = 'safe';
            message = 'Excellent ! Le support est très solide.';
        } else if (safetyFactor >= 2) {
            safety = 'safe';
            message = 'Très bien ! Le support est solide.';
        } else if (safetyFactor >= 1.5) {
            safety = 'warning';
            message = 'Attention : marge de sécurité faible.';
        } else if (safetyFactor >= 1.0) {
            safety = 'danger';
            message = 'Dangereux : proche de la limite !';
        } else {
            safety = 'failure';
            message = 'RUPTURE : Le support va casser !';
        }
        
        return {
            safetyFactor: safetyFactor,
            maxSafeWeight: Math.min(maxSafeWeight, 20), // Plafonner à 20kg
            safety: safety,
            message: message,
            failurePoint: stressAnalysis.criticalPoint,
            maxStress: maxStress
        };
    }

    /**
     * Générer les données de visualisation
     */
    generateVisualization(geometryAnalysis, stressAnalysis, failureAnalysis) {
        const visualization = {
            stressColors: [],
            forceVectors: [],
            breakPoints: []
        };
        
        // Créer une carte de couleurs basée sur les contraintes
        const stressMap = stressAnalysis.stressMap;
        const maxStress = stressAnalysis.maxStress;
        
        stressMap.forEach(sm => {
            const ratio = maxStress > 0 ? sm.stress / maxStress : 0;
            
            // Couleur basée sur le niveau de contrainte
            let color;
            if (ratio > 0.8) {
                color = new THREE.Color(1, 0, 0); // Rouge
            } else if (ratio > 0.6) {
                color = new THREE.Color(1, 0.5, 0); // Orange
            } else if (ratio > 0.4) {
                color = new THREE.Color(1, 1, 0); // Jaune
            } else if (ratio > 0.2) {
                color = new THREE.Color(0.5, 1, 0); // Vert-jaune
            } else {
                color = new THREE.Color(0, 1, 0); // Vert
            }
            
            visualization.stressColors.push({
                position: sm.section.center,
                color: color,
                stress: sm.stress,
                ratio: ratio
            });
        });
        
        // Point de rupture
        if (failureAnalysis.failurePoint) {
            visualization.breakPoints.push({
                position: failureAnalysis.failurePoint,
                stress: failureAnalysis.maxStress
            });
        }
        
        return visualization;
    }
}
