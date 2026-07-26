// Moteur de simulation physique V2 - Analyse correcte des contraintes
// Basé sur le chemin de force réel et détection des concentrations aux angles

class AdvancedPhysicsEngineV2 {
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
     * Simulation complète avec point d'accrochage - VERSION 2
     */
    simulateWithHangingPoint(geometry, meshPosition, meshRotation, hangingPoint, weight) {
        console.log('🔬 === SIMULATION V2 - ANALYSE CHEMIN DE FORCE ===');
        console.log('Point d\'accrochage:', hangingPoint);
        console.log('Poids:', weight, 'kg');

        // 1. Extraire tous les vertices transformés
        const vertices = this.extractVertices(geometry, meshPosition, meshRotation);
        
        // 2. Analyser la structure : trouver ancrage, chemin de force, angles
        const structureAnalysis = this.analyzeStructure(vertices, hangingPoint);
        
        // 3. Calculer les contraintes pour chaque vertex
        const stressAnalysis = this.calculateVertexStress(
            vertices, 
            structureAnalysis, 
            hangingPoint, 
            weight
        );
        
        // 4. Déterminer le résultat (casse ou pas)
        const failureAnalysis = this.analyzeFailure(stressAnalysis, weight);
        
        console.log('✅ Simulation V2 terminée');
        
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
            
            // Appliquer transformations
            v.multiplyScalar(0.1); // Échelle
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
     * Analyser la structure du support
     * - Trouver la zone d'ancrage (dans la table)
     * - Identifier le chemin de force principal
     * - Détecter les angles et jonctions
     */
    analyzeStructure(vertices, hangingPoint) {
        console.log('📐 Analyse de la structure...');
        
        // 1. Séparer les vertices : dans la table vs hors table
        const anchorVertices = [];
        const freeVertices = [];
        
        vertices.forEach(v => {
            if (v.position.y <= this.tableThickness + 0.5 && v.position.y >= -0.5) {
                anchorVertices.push(v);
            } else {
                freeVertices.push(v);
            }
        });
        
        console.log('  Vertices ancrés:', anchorVertices.length);
        console.log('  Vertices libres:', freeVertices.length);
        
        // 2. Calculer le centre d'ancrage
        const anchorCenter = new THREE.Vector3();
        if (anchorVertices.length > 0) {
            anchorVertices.forEach(v => anchorCenter.add(v.position));
            anchorCenter.divideScalar(anchorVertices.length);
        }
        
        // 3. Trouver le point de sortie de table (juste au-dessus de la table)
        // C'est le point d'encastrement
        const exitY = this.tableThickness + 0.1;
        const exitVertices = freeVertices.filter(v => 
            v.position.y >= exitY && v.position.y <= exitY + 3
        );
        
        const exitCenter = new THREE.Vector3();
        if (exitVertices.length > 0) {
            exitVertices.forEach(v => exitCenter.add(v.position));
            exitCenter.divideScalar(exitVertices.length);
        } else {
            exitCenter.copy(anchorCenter);
            exitCenter.y = exitY;
        }
        
        // 4. Analyser la géométrie pour trouver les angles/jonctions
        const angleZones = this.detectAngleZones(vertices, anchorCenter, hangingPoint);
        
        // 5. Calculer le bras de levier effectif
        // = distance horizontale entre l'ancrage et le point d'accrochage
        const leverArm = Math.sqrt(
            Math.pow(hangingPoint.x - anchorCenter.x, 2) +
            Math.pow(hangingPoint.z - anchorCenter.z, 2)
        );
        
        console.log('  Centre d\'ancrage:', anchorCenter.x.toFixed(1), anchorCenter.y.toFixed(1), anchorCenter.z.toFixed(1));
        console.log('  Point de sortie:', exitCenter.x.toFixed(1), exitCenter.y.toFixed(1), exitCenter.z.toFixed(1));
        console.log('  Bras de levier:', leverArm.toFixed(1), 'cm');
        console.log('  Zones d\'angle détectées:', angleZones.length);
        
        return {
            anchorVertices: anchorVertices,
            freeVertices: freeVertices,
            anchorCenter: anchorCenter,
            exitCenter: exitCenter,
            exitY: exitY,
            leverArm: leverArm,
            angleZones: angleZones
        };
    }

    /**
     * Détecter les zones d'angle (jonctions, changements de direction)
     * Ces zones ont des concentrations de contraintes élevées
     * VERSION AMÉLIORÉE pour détecter les jonctions en L
     */
    detectAngleZones(vertices, anchorCenter, hangingPoint) {
        const angleZones = [];
        
        console.log('🔍 Détection des zones d\'angle...');
        
        // MÉTHODE 1 : Analyse par tranches horizontales
        // Détecter les changements de section horizontale
        const horizontalChanges = this.detectHorizontalExtensionChanges(vertices);
        horizontalChanges.forEach(hc => {
            angleZones.push({
                center: hc.center,
                y: hc.y,
                type: 'horizontal_junction',
                angleChange: 90, // Angle droit typique d'une jonction en L
                stressConcentration: 2.5 // Facteur Kt élevé pour angle droit
            });
            console.log('  📐 Jonction horizontale détectée à Y =', hc.y.toFixed(1));
        });
        
        // MÉTHODE 2 : Détecter les changements de direction du centre de masse
        const directionChanges = this.detectDirectionChanges(vertices, anchorCenter, hangingPoint);
        directionChanges.forEach(dc => {
            // Éviter les doublons avec les jonctions horizontales
            const isDuplicate = angleZones.some(az => 
                Math.abs(az.y - dc.y) < 2
            );
            if (!isDuplicate) {
                angleZones.push(dc);
                console.log('  🔄 Changement de direction détecté à Y =', dc.y.toFixed(1));
            }
        });
        
        // MÉTHODE 3 : Détecter les réductions de section
        const sectionChanges = this.detectSectionChanges(vertices);
        sectionChanges.forEach(sc => {
            const isDuplicate = angleZones.some(az => 
                Math.abs(az.y - sc.y) < 2
            );
            if (!isDuplicate) {
                angleZones.push({
                    center: sc.center,
                    y: sc.y,
                    type: 'section_reduction',
                    angleChange: 0,
                    sectionReduction: sc.reduction,
                    stressConcentration: 1 + sc.reduction * 2
                });
            }
        });
        
        console.log('  Total zones critiques:', angleZones.length);
        
        return angleZones;
    }
    
    /**
     * Détecter les extensions horizontales (bras d'un L)
     * Quand le support s'étend soudainement vers l'extérieur
     */
    detectHorizontalExtensionChanges(vertices) {
        const changes = [];
        const sliceHeight = 1;
        
        // Trouver les limites Y au-dessus de la table
        let minY = Infinity, maxY = -Infinity;
        vertices.forEach(v => {
            if (v.position.y > this.tableThickness) {
                minY = Math.min(minY, v.position.y);
                maxY = Math.max(maxY, v.position.y);
            }
        });
        
        // Analyser chaque tranche
        let prevSlice = null;
        
        for (let y = minY; y <= maxY; y += sliceHeight) {
            const sliceVertices = vertices.filter(v => 
                v.position.y >= y && v.position.y < y + sliceHeight
            );
            
            if (sliceVertices.length < 3) continue;
            
            // Calculer les dimensions de cette tranche
            const xs = sliceVertices.map(v => v.position.x);
            const zs = sliceVertices.map(v => v.position.z);
            
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            const zMin = Math.min(...zs);
            const zMax = Math.max(...zs);
            
            const width = xMax - xMin;
            const depth = zMax - zMin;
            
            // Centre de cette tranche
            const centerX = (xMin + xMax) / 2;
            const centerZ = (zMin + zMax) / 2;
            
            const currentSlice = {
                y: y,
                width: width,
                depth: depth,
                xMin: xMin,
                xMax: xMax,
                zMin: zMin,
                zMax: zMax,
                centerX: centerX,
                centerZ: centerZ
            };
            
            if (prevSlice) {
                // Détecter une extension soudaine
                // Si la largeur ou profondeur augmente significativement
                const widthRatio = width / prevSlice.width;
                const depthRatio = depth / prevSlice.depth;
                
                // Détecter un décalage du centre (indication d'un bras qui part sur le côté)
                const centerShiftX = Math.abs(centerX - prevSlice.centerX);
                const centerShiftZ = Math.abs(centerZ - prevSlice.centerZ);
                const totalShift = Math.sqrt(centerShiftX * centerShiftX + centerShiftZ * centerShiftZ);
                
                // Conditions pour détecter une jonction en L :
                // 1. Extension significative (>50%)
                // 2. OU décalage du centre significatif (>2cm)
                const hasExtension = widthRatio > 1.5 || depthRatio > 1.5;
                const hasCenterShift = totalShift > 2;
                
                if (hasExtension || hasCenterShift) {
                    changes.push({
                        y: y,
                        center: new THREE.Vector3(centerX, y, centerZ),
                        widthRatio: widthRatio,
                        depthRatio: depthRatio,
                        centerShift: totalShift
                    });
                }
            }
            
            prevSlice = currentSlice;
        }
        
        return changes;
    }
    
    /**
     * Détecter les changements de direction du centre de masse
     */
    detectDirectionChanges(vertices, anchorCenter, hangingPoint) {
        const changes = [];
        const sliceHeight = 1;
        
        // Trouver les limites
        let minY = Infinity, maxY = -Infinity;
        vertices.forEach(v => {
            if (v.position.y > this.tableThickness) {
                minY = Math.min(minY, v.position.y);
                maxY = Math.max(maxY, v.position.y);
            }
        });
        
        // Calculer les centres de chaque tranche
        const sliceCenters = [];
        
        for (let y = minY; y <= maxY; y += sliceHeight) {
            const sliceVertices = vertices.filter(v => 
                v.position.y >= y && v.position.y < y + sliceHeight
            );
            
            if (sliceVertices.length < 3) continue;
            
            const center = new THREE.Vector3();
            sliceVertices.forEach(v => center.add(v.position));
            center.divideScalar(sliceVertices.length);
            
            sliceCenters.push({
                y: y,
                center: center
            });
        }
        
        // Analyser les changements de direction entre centres consécutifs
        for (let i = 2; i < sliceCenters.length; i++) {
            const prev2 = sliceCenters[i - 2];
            const prev1 = sliceCenters[i - 1];
            const curr = sliceCenters[i];
            
            // Direction entre prev2 et prev1
            const dir1 = new THREE.Vector2(
                prev1.center.x - prev2.center.x,
                prev1.center.z - prev2.center.z
            );
            
            // Direction entre prev1 et curr
            const dir2 = new THREE.Vector2(
                curr.center.x - prev1.center.x,
                curr.center.z - prev1.center.z
            );
            
            // Calculer l'angle entre les deux directions
            const len1 = dir1.length();
            const len2 = dir2.length();
            
            if (len1 > 0.5 && len2 > 0.5) { // Mouvements significatifs
                dir1.normalize();
                dir2.normalize();
                
                const dot = dir1.dot(dir2);
                const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
                
                // Changement de direction significatif (> 30°)
                if (angle > 30) {
                    changes.push({
                        center: prev1.center.clone(),
                        y: prev1.y,
                        type: 'direction_change',
                        angleChange: angle,
                        stressConcentration: 1 + (angle / 45) * 1.5 // Kt = 1 à 2.5
                    });
                }
            }
        }
        
        return changes;
    }

    /**
     * Détecter les changements de section (réductions)
     */
    detectSectionChanges(vertices) {
        const changes = [];
        const sliceHeight = 1;
        
        // Trouver les limites
        let minY = Infinity, maxY = -Infinity;
        vertices.forEach(v => {
            if (v.position.y > this.tableThickness) {
                minY = Math.min(minY, v.position.y);
                maxY = Math.max(maxY, v.position.y);
            }
        });
        
        let prevSection = null;
        
        for (let y = minY; y <= maxY; y += sliceHeight) {
            const sliceVertices = vertices.filter(v => 
                v.position.y >= y && v.position.y < y + sliceHeight
            );
            
            if (sliceVertices.length < 3) continue;
            
            // Calculer la section (approximation par bounding box)
            const xs = sliceVertices.map(v => v.position.x);
            const zs = sliceVertices.map(v => v.position.z);
            const width = Math.max(...xs) - Math.min(...xs);
            const depth = Math.max(...zs) - Math.min(...zs);
            const area = width * depth;
            
            const center = new THREE.Vector3(
                (Math.max(...xs) + Math.min(...xs)) / 2,
                y + sliceHeight / 2,
                (Math.max(...zs) + Math.min(...zs)) / 2
            );
            
            if (prevSection && prevSection.area > 0) {
                const reduction = 1 - (area / prevSection.area);
                // Détecter les réductions significatives (> 20%)
                if (reduction > 0.2) {
                    changes.push({
                        center: center,
                        y: y,
                        reduction: reduction,
                        fromArea: prevSection.area,
                        toArea: area
                    });
                }
            }
            
            prevSection = { area, width, depth, center };
        }
        
        return changes;
    }

    /**
     * Calculer les contraintes pour chaque vertex
     * Basé sur le moment de flexion réel et les concentrations de contraintes
     * VERSION AMÉLIORÉE avec meilleure gestion des jonctions
     */
    calculateVertexStress(vertices, structure, hangingPoint, weight) {
        console.log('📊 Calcul des contraintes par vertex (V2)...');
        
        const force = weight * this.gravity; // N
        const stressMap = [];
        
        // Moment maximum à l'encastrement (sortie de table)
        const maxMoment = force * (structure.leverArm / 100); // N⋅m
        
        console.log('  Force:', force.toFixed(1), 'N');
        console.log('  Bras de levier:', structure.leverArm.toFixed(1), 'cm');
        console.log('  Moment max:', maxMoment.toFixed(2), 'N⋅m');
        console.log('  Zones d\'angle:', structure.angleZones.length);
        
        // Pré-calculer les distances pour normalisation
        let maxDistToHang = 0;
        vertices.forEach(v => {
            if (v.position.y > this.tableThickness) {
                const dist = Math.sqrt(
                    Math.pow(v.position.x - hangingPoint.x, 2) +
                    Math.pow(v.position.z - hangingPoint.z, 2)
                );
                maxDistToHang = Math.max(maxDistToHang, dist);
            }
        });
        
        // Pour chaque vertex, calculer sa contrainte
        vertices.forEach(v => {
            const pos = v.position;
            
            // 1. Si dans la zone d'ancrage (table), contrainte = 0
            if (pos.y <= this.tableThickness + 0.3) {
                stressMap.push({
                    vertex: v,
                    stress: 0,
                    inAnchorZone: true,
                    moment: 0,
                    leverFraction: 0,
                    concentrationFactor: 1
                });
                return;
            }
            
            // 2. Calculer la distance horizontale au point d'accrochage
            const horizDistToHang = Math.sqrt(
                Math.pow(pos.x - hangingPoint.x, 2) +
                Math.pow(pos.z - hangingPoint.z, 2)
            );
            
            // 3. Calculer le moment local
            // Le moment est proportionnel à la distance horizontale vers l'ancrage
            // M(x) = F × distance_horizontale_du_point_accrochage
            const localMoment = force * (horizDistToHang / 100); // N⋅m
            
            // 4. Estimer la section locale
            const localSection = this.estimateLocalSection(pos, vertices);
            
            // 5. Calculer la contrainte de flexion σ = M × c / I
            const b = Math.max(localSection.width, 0.3) / 100; // m
            const h = Math.max(localSection.depth, 0.3) / 100; // m
            const I = (b * Math.pow(h, 3)) / 12;
            const c = h / 2;
            
            let baseStress = I > 0 ? (localMoment * c / I) / 1e6 : 0; // MPa
            
            // 6. Calculer les facteurs de concentration de contraintes
            let concentrationFactor = 1.0;
            let dominantFactor = 'none';
            
            // 6a. FACTEUR CRITIQUE : Proximité des zones d'angle/jonction
            // C'est LE facteur le plus important pour les supports en L
            structure.angleZones.forEach(zone => {
                const distToZone = pos.distanceTo(zone.center);
                
                if (distToZone < 8) { // Dans un rayon de 8 cm de la jonction
                    // Plus on est proche de la jonction, plus la concentration est forte
                    const attenuation = Math.pow(1 - (distToZone / 8), 2); // Quadratique
                    const zoneFactor = 1 + (zone.stressConcentration - 1) * attenuation;
                    
                    if (zoneFactor > concentrationFactor) {
                        concentrationFactor = zoneFactor;
                        dominantFactor = zone.type || 'angle';
                    }
                }
            });
            
            // 6b. Proximité de la sortie de table (encastrement)
            const distFromExit = pos.y - structure.exitY;
            if (distFromExit >= 0 && distFromExit <= 3) {
                // Zone critique près de l'encastrement
                const exitFactor = 2.0 - (distFromExit / 3) * 1.0; // 2.0 -> 1.0
                if (exitFactor > concentrationFactor) {
                    concentrationFactor = exitFactor;
                    dominantFactor = 'table_exit';
                }
            }
            
            // 6c. Facteur de position sur le chemin de force
            // La contrainte augmente en s'éloignant du point d'accrochage
            const leverFraction = maxDistToHang > 0 ? horizDistToHang / maxDistToHang : 0;
            
            // Amplifier légèrement les contraintes loin du point d'accrochage
            if (leverFraction > 0.3) {
                const posFactor = 1 + (leverFraction - 0.3) * 0.3;
                concentrationFactor *= posFactor;
            }
            
            // 7. Contrainte finale
            const finalStress = baseStress * concentrationFactor;
            
            stressMap.push({
                vertex: v,
                stress: finalStress,
                inAnchorZone: false,
                moment: localMoment,
                baseStress: baseStress,
                concentrationFactor: concentrationFactor,
                dominantFactor: dominantFactor,
                leverFraction: leverFraction,
                localSection: localSection
            });
        });
        
        // Trouver le maximum et analyser
        let maxStress = 0;
        let maxStressVertex = null;
        let maxStressFactor = '';
        
        stressMap.forEach(sm => {
            if (sm.stress > maxStress && !sm.inAnchorZone) {
                maxStress = sm.stress;
                maxStressVertex = sm.vertex;
                maxStressFactor = sm.dominantFactor;
            }
        });
        
        console.log('  Contrainte max:', maxStress.toFixed(2), 'MPa');
        console.log('  Facteur dominant:', maxStressFactor);
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
            criticalPoint: maxStressVertex ? maxStressVertex.position : structure.exitCenter,
            criticalFactor: maxStressFactor
        };
    }

    /**
     * Estimer la section locale autour d'un point
     */
    estimateLocalSection(pos, vertices) {
        // Trouver les vertices dans un voisinage
        const neighborRadius = 2; // cm
        const neighbors = vertices.filter(v => 
            v.position.distanceTo(pos) < neighborRadius
        );
        
        if (neighbors.length < 3) {
            return { width: 1, depth: 1, area: 1 };
        }
        
        // Calculer les dimensions du voisinage
        const xs = neighbors.map(v => v.position.x);
        const zs = neighbors.map(v => v.position.z);
        
        const width = Math.max(...xs) - Math.min(...xs);
        const depth = Math.max(...zs) - Math.min(...zs);
        
        return {
            width: Math.max(width, 0.5),
            depth: Math.max(depth, 0.5),
            area: Math.max(width * depth, 0.25)
        };
    }

    /**
     * Analyser si le support va casser
     */
    analyzeFailure(stressAnalysis, currentWeight) {
        const maxStress = stressAnalysis.maxStress;
        const yieldStrength = this.material.yieldStrength;
        
        // Facteur de sécurité
        const safetyFactor = maxStress > 0 ? yieldStrength / maxStress : Infinity;
        
        // Poids maximum sûr
        let maxSafeWeight;
        if (safetyFactor > 2) {
            maxSafeWeight = currentWeight * (safetyFactor / 2);
        } else {
            maxSafeWeight = currentWeight * safetyFactor * 0.8;
        }
        
        // Plafonner à des valeurs raisonnables
        maxSafeWeight = Math.min(maxSafeWeight, 25);
        
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
        
        console.log('📋 Analyse rupture:');
        console.log('  Contrainte max:', maxStress.toFixed(2), 'MPa');
        console.log('  Limite PLA:', yieldStrength, 'MPa');
        console.log('  Facteur sécurité:', safetyFactor.toFixed(2));
        console.log('  Poids max sûr:', maxSafeWeight.toFixed(1), 'kg');
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

// Exporter pour utilisation globale
window.AdvancedPhysicsEngineV2 = AdvancedPhysicsEngineV2;
