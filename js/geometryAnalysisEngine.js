// Moteur V5 - Analyse GÉOMÉTRIQUE pure
// Détection des fragilités par : angles vifs (normales) + épaisseur (raycasting)

class GeometryAnalysisEngine {
    constructor() {
        this.tableThickness = 1.9;
        this.tableEdgeX = 0;
        
        // Seuils
        this.sharpAngleThreshold = 45; // degrés - en dessous = angle vif
        this.thinThreshold = 0.5; // cm - en dessous = fin
        this.thickThreshold = 1.5; // cm - au dessus = épais
    }

    /**
     * Point d'entrée principal
     */
    simulateWithHangingPoint(geometry, meshPosition, meshRotation, hangingPoint, weight) {
        console.log('🔬 === MOTEUR V5 - ANALYSE GÉOMÉTRIQUE ===');
        
        // 1. Créer un mesh temporaire pour le raycasting
        const tempGeometry = geometry.clone();
        const tempMesh = new THREE.Mesh(
            tempGeometry,
            new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
        );
        tempMesh.scale.set(0.1, 0.1, 0.1);
        tempMesh.rotation.copy(meshRotation);
        tempMesh.position.copy(meshPosition);
        tempMesh.updateMatrixWorld(true);
        
        // 2. Extraire les données des triangles (vertices + normales)
        const trianglesData = this.extractTrianglesData(geometry, meshPosition, meshRotation);
        
        // 3. Pour chaque vertex, calculer :
        //    - La variation des normales (angle vif ou arrondi)
        //    - L'épaisseur locale (raycasting)
        const vertexAnalysis = this.analyzeVertices(trianglesData, tempMesh);
        
        // 4. Calculer le score de fragilité pour chaque vertex
        const stressAnalysis = this.calculateFragilityScore(vertexAnalysis, hangingPoint, weight);
        
        // 5. Résultat
        const failureAnalysis = this.analyzeFailure(stressAnalysis, weight);
        
        // Cleanup
        tempGeometry.dispose();
        
        return {
            stressAnalysis,
            failureAnalysis,
            maxWeight: failureAnalysis.maxSafeWeight,
            safety: failureAnalysis.safety
        };
    }

    /**
     * Extraire les données de chaque triangle : positions et normale
     */
    extractTrianglesData(geometry, meshPosition, meshRotation) {
        const positions = geometry.attributes.position;
        const triangles = [];
        const vertexToTriangles = new Map(); // position key -> triangles qui contiennent ce point
        
        const positionKey = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
        
        // Parcourir chaque triangle (3 vertices)
        for (let i = 0; i < positions.count; i += 3) {
            // Les 3 vertices du triangle en coordonnées monde
            const v0 = this.getWorldVertex(positions, i, meshPosition, meshRotation);
            const v1 = this.getWorldVertex(positions, i + 1, meshPosition, meshRotation);
            const v2 = this.getWorldVertex(positions, i + 2, meshPosition, meshRotation);
            
            // Calculer la normale du triangle
            const edge1 = new THREE.Vector3().subVectors(v1, v0);
            const edge2 = new THREE.Vector3().subVectors(v2, v0);
            const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
            
            // Ignorer les triangles dégénérés
            if (normal.length() < 0.5) continue;
            
            const triangle = {
                index: i / 3,
                vertices: [v0, v1, v2],
                vertexIndices: [i, i + 1, i + 2],
                normal: normal,
                center: new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3)
            };
            
            triangles.push(triangle);
            
            // Mapper les POSITIONS (pas les indices) aux triangles
            // Ceci permet de trouver tous les triangles qui partagent un même point géométrique
            [v0, v1, v2].forEach((v, localIdx) => {
                const key = positionKey(v);
                if (!vertexToTriangles.has(key)) {
                    vertexToTriangles.set(key, []);
                }
                vertexToTriangles.get(key).push(triangle);
            });
        }
        
        console.log('  Triangles extraits:', triangles.length);
        console.log('  Positions uniques:', vertexToTriangles.size);
        
        return { triangles, vertexToTriangles, positions, meshPosition, meshRotation, positionKey };
    }

    /**
     * Obtenir un vertex en coordonnées monde
     */
    getWorldVertex(positions, index, meshPosition, meshRotation) {
        const v = new THREE.Vector3(
            positions.getX(index),
            positions.getY(index),
            positions.getZ(index)
        );
        v.multiplyScalar(0.1);
        v.applyEuler(meshRotation);
        v.add(meshPosition);
        return v;
    }

    /**
     * Analyser chaque vertex : variation des normales + épaisseur
     */
    analyzeVertices(trianglesData, tempMesh) {
        const { triangles, vertexToTriangles, positions, meshPosition, meshRotation, positionKey } = trianglesData;
        const vertexAnalysis = [];
        
        const raycaster = new THREE.Raycaster();
        raycaster.firstHitOnly = true;
        
        console.log('  Analyse des vertices...');
        
        for (let i = 0; i < positions.count; i++) {
            const worldPos = this.getWorldVertex(positions, i, meshPosition, meshRotation);
            const key = positionKey(worldPos);
            
            // === 1. VARIATION DES NORMALES ===
            // Récupérer tous les triangles qui partagent cette POSITION (pas cet index)
            const adjacentTriangles = vertexToTriangles.get(key) || [];
            
            let normalVariation = 0;
            let averageNormal = new THREE.Vector3();
            
            if (adjacentTriangles.length > 0) {
                // Calculer la normale moyenne
                adjacentTriangles.forEach(t => averageNormal.add(t.normal));
                averageNormal.divideScalar(adjacentTriangles.length).normalize();
                
                // Calculer la variation (écart par rapport à la moyenne)
                let totalAngle = 0;
                adjacentTriangles.forEach(t => {
                    const angle = Math.acos(Math.max(-1, Math.min(1, t.normal.dot(averageNormal))));
                    totalAngle += angle;
                });
                
                const avgAngle = totalAngle / adjacentTriangles.length;
                normalVariation = Math.min(1, avgAngle / (Math.PI / 2));
            }
            
            // === 2. ÉPAISSEUR LOCALE (Raycasting) ===
            let thickness = 10;
            
            if (averageNormal.length() > 0.5) {
                const rayDir = averageNormal.clone().negate();
                const rayOrigin = worldPos.clone().add(rayDir.clone().multiplyScalar(0.05));
                
                raycaster.set(rayOrigin, rayDir);
                const intersects = raycaster.intersectObject(tempMesh);
                
                if (intersects.length > 0) {
                    thickness = intersects[0].distance;
                }
            }
            
            // === 3. DÉTECTER LES ANGLES VIFS ===
            // Comparer les normales de tous les triangles adjacents entre eux
            let maxAngleBetweenFaces = 0;
            
            for (let t1 = 0; t1 < adjacentTriangles.length; t1++) {
                for (let t2 = t1 + 1; t2 < adjacentTriangles.length; t2++) {
                    const dot = adjacentTriangles[t1].normal.dot(adjacentTriangles[t2].normal);
                    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
                    maxAngleBetweenFaces = Math.max(maxAngleBetweenFaces, angle);
                }
            }
            
            // Angle vif si > 45° (plus sensible qu'avant)
            const isSharpEdge = maxAngleBetweenFaces > 45;
            
            vertexAnalysis.push({
                index: i,
                position: worldPos,
                normal: averageNormal,
                normalVariation: normalVariation,
                thickness: thickness,
                maxAngleBetweenFaces: maxAngleBetweenFaces,
                isSharpEdge: isSharpEdge,
                adjacentTriangleCount: adjacentTriangles.length
            });
        }
        
        // Stats
        const sharpCount = vertexAnalysis.filter(v => v.isSharpEdge).length;
        const thinCount = vertexAnalysis.filter(v => v.thickness < this.thinThreshold).length;
        const avgAdjacent = vertexAnalysis.reduce((sum, v) => sum + v.adjacentTriangleCount, 0) / vertexAnalysis.length;
        
        console.log('  Vertices avec angle vif (>45°):', sharpCount);
        console.log('  Vertices fins:', thinCount);
        console.log('  Triangles adjacents moyens par vertex:', avgAdjacent.toFixed(1));
        
        return vertexAnalysis;
    }

    /**
     * Calculer le score de fragilité pour chaque vertex
     */
    calculateFragilityScore(vertexAnalysis, hangingPoint, weight) {
        console.log('  Calcul des scores de fragilité...');
        
        const stressMap = [];
        let maxStress = 0;
        let maxStressVertex = null;
        
        // Calculer le bras de levier (distance horizontale du bord au point d'accrochage)
        const leverArm = Math.abs(hangingPoint.x - this.tableEdgeX);
        console.log('  Bras de levier:', leverArm.toFixed(1), 'cm');
        
        // FACTEUR GLOBAL : Bras de levier
        // 1-2 cm = très bien (facteur 1)
        // 3-4 cm = ok (facteur 1.5)
        // 5+ cm = risqué (facteur 2+)
        // 10+ cm = très risqué (facteur 3+)
        let leverArmGlobalFactor = 1.0;
        if (leverArm <= 2) {
            leverArmGlobalFactor = 1.0;
        } else if (leverArm <= 4) {
            leverArmGlobalFactor = 1.0 + (leverArm - 2) * 0.25; // 1.0 à 1.5
        } else if (leverArm <= 8) {
            leverArmGlobalFactor = 1.5 + (leverArm - 4) * 0.375; // 1.5 à 3.0
        } else {
            leverArmGlobalFactor = 3.0 + (leverArm - 8) * 0.25; // 3.0+
        }
        console.log('  Facteur bras de levier global:', leverArmGlobalFactor.toFixed(2));
        
        vertexAnalysis.forEach(va => {
            const pos = va.position;
            
            // === ZONE D'ANCRAGE ===
            if (pos.y > this.tableThickness + 0.5 && pos.x < -1) {
                stressMap.push({
                    vertex: { position: pos, index: va.index },
                    stress: 0,
                    inAnchorZone: true
                });
                return;
            }
            
            // === FACTEUR 1 : GÉOMÉTRIE (angle vif vs courbe vs plat) ===
            let geometryFactor = 1.0;
            
            if (va.isSharpEdge && va.maxAngleBetweenFaces > 70) {
                // Angle TRÈS vif (> 70°) = TRÈS fragile (jonction à 90°)
                geometryFactor = 3.0 + (va.maxAngleBetweenFaces - 70) * 0.1; // 3.0 à 5.0
            } else if (va.isSharpEdge && va.maxAngleBetweenFaces > 45) {
                // Angle vif modéré (45-70°) = fragile
                geometryFactor = 1.5 + (va.maxAngleBetweenFaces - 45) * 0.06; // 1.5 à 3.0
            } else if (va.maxAngleBetweenFaces > 15 && va.maxAngleBetweenFaces <= 45) {
                // COURBE (15-45°) = BONNE pour la résistance !
                // La courbe distribue les contraintes → réduire le score
                geometryFactor = 0.6 + (va.maxAngleBetweenFaces / 45) * 0.3; // 0.6 à 0.9
            } else {
                // Surface plate (< 15°) = neutre
                geometryFactor = 1.0;
            }
            
            // === FACTEUR 2 : ÉPAISSEUR ===
            let thicknessFactor = 1.0;
            
            // Si angle vif, considérer automatiquement comme fin
            if (va.isSharpEdge && va.maxAngleBetweenFaces > 60) {
                thicknessFactor = 2.0;
            } else if (va.thickness < this.thinThreshold) {
                thicknessFactor = 2.5 - (va.thickness / this.thinThreshold) * 1.0;
            } else if (va.thickness < this.thickThreshold) {
                thicknessFactor = 1.2 + (1 - va.thickness / this.thickThreshold) * 0.3;
            } else {
                thicknessFactor = 0.7;
            }
            
            // === FACTEUR 3 : POSITION LOCALE ===
            // Zone critique = près du bord de table ET sous la table
            let positionFactor = 1.0;
            
            // Distance au bord de table (X = 0)
            const distToEdge = Math.abs(pos.x - this.tableEdgeX);
            
            // Zone critique : dans les 3 premiers cm après le bord de table
            if (pos.x >= this.tableEdgeX - 1 && pos.x <= this.tableEdgeX + 3) {
                // Très proche du bord = zone de moment max
                positionFactor = 2.0 - (distToEdge / 3) * 0.5; // 2.0 à 1.5
            } else if (pos.x > this.tableEdgeX + 3) {
                // Plus loin du bord, vers le point d'accrochage
                // Le moment diminue en s'approchant du point d'accrochage
                const distToHang = Math.abs(pos.x - hangingPoint.x);
                if (leverArm > 0) {
                    positionFactor = 0.8 + (distToHang / leverArm) * 0.7;
                }
            } else {
                // Derrière le bord (côté table)
                positionFactor = 1.2;
            }
            
            // === FACTEUR 4 : HAUTEUR (jonction verticale/horizontale) ===
            let heightFactor = 1.0;
            
            // La jonction critique est souvent juste sous le niveau de la table
            // ou au niveau de la transition vers la partie horizontale
            if (pos.y < 0 && pos.y > -5) {
                // Juste sous la table = zone de transition critique
                heightFactor = 1.5;
            } else if (pos.y >= 0 && pos.y < this.tableThickness) {
                heightFactor = 1.2;
            }
            
            // === SCORE FINAL ===
            // Appliquer le facteur global du bras de levier
            const stress = geometryFactor * thicknessFactor * positionFactor * heightFactor * leverArmGlobalFactor;
            
            stressMap.push({
                vertex: { position: pos, index: va.index },
                stress: stress,
                inAnchorZone: false,
                factors: {
                    geometry: geometryFactor,
                    thickness: thicknessFactor,
                    position: positionFactor,
                    height: heightFactor,
                    leverArm: leverArmGlobalFactor
                },
                rawData: {
                    isSharpEdge: va.isSharpEdge,
                    maxAngle: va.maxAngleBetweenFaces,
                    thickness: va.thickness
                }
            });
            
            if (stress > maxStress) {
                maxStress = stress;
                maxStressVertex = { position: pos, index: va.index };
            }
        });
        
        console.log('  Score de fragilité max:', maxStress.toFixed(2));
        
        return {
            stressMap,
            maxStress,
            maxStressVertex,
            criticalPoint: maxStressVertex ? maxStressVertex.position : null,
            leverArm: leverArm,
            leverArmFactor: leverArmGlobalFactor
        };
    }

    /**
     * Analyser si ça casse + conseils
     */
    analyzeFailure(stressAnalysis, weight) {
        const maxScore = stressAnalysis.maxStress;
        const leverArm = stressAnalysis.leverArm || 5;
        const stressMap = stressAnalysis.stressMap || [];
        
        // === CALCUL DES MÉTRIQUES ===
        const activeVertices = stressMap.filter(s => !s.inAnchorZone);
        const totalVertices = activeVertices.length || 1;
        
        const scores = activeVertices.map(s => s.stress);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        
        // Vertices très critiques (>80% du max)
        const criticalCount = scores.filter(s => s > maxScore * 0.8).length;
        const criticalRatio = criticalCount / totalVertices;
        
        // Vertices moyennement critiques (60-80% du max)  
        const mediumCount = scores.filter(s => s > maxScore * 0.6 && s <= maxScore * 0.8).length;
        const mediumRatio = mediumCount / totalVertices;
        
        console.log('=== DEBUG ANALYSE ===');
        console.log('Ratio critique (>80%):', (criticalRatio * 100).toFixed(1) + '%');
        console.log('Ratio medium (60-80%):', (mediumRatio * 100).toFixed(1) + '%');
        console.log('Bras de levier:', leverArm.toFixed(1), 'cm');
        
        // === FACTEUR GÉOMÉTRIE ===
        // Seuils calibrés sur les tests réels :
        // - Courbe (ratio ~18.5%) → doit donner ~6kg
        // - L fragile (ratio ~23%) → doit donner ~1kg
        
        let geometryFactor;
        if (criticalRatio < 0.15) {
            // Excellent : très peu de zones critiques
            geometryFactor = 1.0;
        } else if (criticalRatio < 0.19) {
            // Bon (courbes bien conçues) : 15% → 1.0, 19% → 0.70
            geometryFactor = 1.0 - (criticalRatio - 0.15) * 7.5;
        } else if (criticalRatio < 0.22) {
            // Moyen : 19% → 0.70, 22% → 0.25
            geometryFactor = 0.70 - (criticalRatio - 0.19) * 15.0;
        } else if (criticalRatio < 0.26) {
            // Fragile (angles vifs) : 22% → 0.18, 26% → 0.08
            geometryFactor = 0.18 - (criticalRatio - 0.22) * 2.5;
        } else {
            // Très fragile
            geometryFactor = Math.max(0.05, 0.08 - (criticalRatio - 0.26) * 0.3);
        }
        
        console.log('Facteur géométrie:', geometryFactor.toFixed(2));
        
        // === FACTEUR DISTANCE ===
        let distanceFactor;
        if (leverArm <= 2) {
            distanceFactor = 1.0;
        } else if (leverArm <= 4) {
            distanceFactor = 1.0 - (leverArm - 2) * 0.075; // 1.0 → 0.85
        } else if (leverArm <= 6) {
            distanceFactor = 0.85 - (leverArm - 4) * 0.1; // 0.85 → 0.65
        } else if (leverArm <= 8) {
            distanceFactor = 0.65 - (leverArm - 6) * 0.125; // 0.65 → 0.40
        } else {
            distanceFactor = Math.max(0.2, 0.40 - (leverArm - 8) * 0.05);
        }
        console.log('Facteur distance:', distanceFactor.toFixed(2));
        
        // === POIDS MAX ===
        // Base 10kg pour avoir une bonne plage
        let maxSafeWeight = 10.0 * geometryFactor * distanceFactor;
        
        // Arrondir à 0.5kg, minimum 0.5kg, pas de maximum
        maxSafeWeight = Math.round(maxSafeWeight * 2) / 2;
        maxSafeWeight = Math.max(0.5, maxSafeWeight);
        
        console.log('>>> POIDS MAX:', maxSafeWeight, 'kg');
        
        // === VERDICT ===
        let safety;
        if (maxSafeWeight >= 5) {
            safety = 'safe';
        } else if (maxSafeWeight >= 2.5) {
            safety = 'warning';
        } else {
            safety = 'danger';
        }
        
        // Conseil bras de levier
        let leverArmAdvice = '';
        if (leverArm <= 2) {
            leverArmAdvice = '✓ Accrochage proche';
        } else if (leverArm <= 4) {
            leverArmAdvice = 'Accrochage ' + leverArm.toFixed(0) + 'cm : OK';
        } else if (leverArm <= 7) {
            leverArmAdvice = '⚠ ' + leverArm.toFixed(0) + 'cm : rapproche !';
        } else {
            leverArmAdvice = '❌ Trop loin (' + leverArm.toFixed(0) + 'cm)';
        }
        
        return {
            safetyFactor: geometryFactor * distanceFactor,
            maxSafeWeight,
            safety,
            message: safety === 'safe' ? 'Support solide' : safety === 'warning' ? 'Support fragile' : 'Risque élevé',
            maxStress: maxScore,
            failurePoint: stressAnalysis.criticalPoint,
            leverArm,
            leverArmAdvice,
            criticalRatio,
            geometryFactor,
            distanceFactor
        };
    }
}

window.GeometryAnalysisEngine = GeometryAnalysisEngine;
