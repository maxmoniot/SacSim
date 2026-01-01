// Orchestrateur de simulation
class Simulator {
    constructor() {
        this.physics = new PhysicsSimulator();
        this.currentGeometry = null;
        this.currentPosition = null;
        this.currentWeight = 5.0;
        this.simulationHistory = [];
        this.isSimulating = false;
    }

    setGeometry(geometry) {
        this.currentGeometry = geometry;
    }

    setPosition(position) {
        this.currentPosition = position;
    }

    setWeight(weight) {
        this.currentWeight = weight;
    }

    async runSimulation() {
        if (!this.currentGeometry) {
            throw new Error('Aucune géométrie chargée');
        }

        if (this.isSimulating) {
            console.warn('Une simulation est déjà en cours');
            return;
        }

        this.isSimulating = true;

        try {
            // Petite pause pour l'effet de chargement
            await this.delay(500);

            // Exécuter la simulation physique
            const result = this.physics.simulate(
                this.currentGeometry,
                this.currentPosition || new THREE.Vector3(0, 0, 0),
                this.currentWeight
            );

            // Ajouter à l'historique
            this.simulationHistory.push({
                timestamp: Date.now(),
                weight: this.currentWeight,
                result: result
            });

            // Limiter l'historique à 50 entrées
            if (this.simulationHistory.length > 50) {
                this.simulationHistory.shift();
            }

            return result;

        } finally {
            this.isSimulating = false;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Analyse rapide sans simulation complète
    quickAnalysis() {
        if (!this.currentGeometry) {
            return null;
        }

        return this.physics.analyzeGeometry(this.currentGeometry);
    }

    // Vérifier la stabilité
    checkStability() {
        if (!this.currentGeometry) {
            return null;
        }

        return this.physics.checkStability(
            this.currentGeometry,
            this.currentPosition || new THREE.Vector3(0, 0, 0)
        );
    }

    // Trouver le poids maximum supportable
    async findMaxWeight() {
        if (!this.currentGeometry) {
            throw new Error('Aucune géométrie chargée');
        }

        const maxWeight = this.physics.findMaxWeight(
            this.currentGeometry,
            this.currentPosition || new THREE.Vector3(0, 0, 0)
        );

        return maxWeight;
    }

    // Obtenir l'historique des simulations
    getHistory() {
        return this.simulationHistory;
    }

    // Effacer l'historique
    clearHistory() {
        this.simulationHistory = [];
    }

    // Obtenir les statistiques de l'historique
    getHistoryStats() {
        if (this.simulationHistory.length === 0) {
            return null;
        }

        const weights = this.simulationHistory.map(h => h.weight);
        const safetyFactors = this.simulationHistory.map(h => h.result.safetyFactor);

        return {
            totalSimulations: this.simulationHistory.length,
            minWeight: Math.min(...weights),
            maxWeight: Math.max(...weights),
            avgWeight: weights.reduce((a, b) => a + b, 0) / weights.length,
            minSafetyFactor: Math.min(...safetyFactors),
            maxSafetyFactor: Math.max(...safetyFactors),
            avgSafetyFactor: safetyFactors.reduce((a, b) => a + b, 0) / safetyFactors.length
        };
    }

    // Comparer deux configurations
    compare(weight1, weight2) {
        if (!this.currentGeometry) {
            throw new Error('Aucune géométrie chargée');
        }

        const result1 = this.physics.simulate(
            this.currentGeometry,
            this.currentPosition || new THREE.Vector3(0, 0, 0),
            weight1
        );

        const result2 = this.physics.simulate(
            this.currentGeometry,
            this.currentPosition || new THREE.Vector3(0, 0, 0),
            weight2
        );

        return {
            weight1: {
                weight: weight1,
                result: result1
            },
            weight2: {
                weight: weight2,
                result: result2
            },
            comparison: {
                stressDifference: Math.abs(result1.maxStress - result2.maxStress),
                safetyFactorDifference: Math.abs(result1.safetyFactor - result2.safetyFactor),
                betterOption: result1.safetyFactor > result2.safetyFactor ? weight1 : weight2
            }
        };
    }

    // Générer un rapport de simulation
    generateReport() {
        if (!this.currentGeometry || this.simulationHistory.length === 0) {
            return null;
        }

        const lastSimulation = this.simulationHistory[this.simulationHistory.length - 1];
        const analysis = this.quickAnalysis();
        const stability = this.checkStability();

        return {
            date: new Date().toLocaleString('fr-FR'),
            geometry: {
                dimensions: analysis.dimensions,
                volume: analysis.volume,
                surfaceArea: analysis.surfaceArea,
                triangleCount: analysis.triangleCount
            },
            simulation: {
                weight: lastSimulation.weight,
                maxStress: lastSimulation.result.maxStress,
                safetyFactor: lastSimulation.result.safetyFactor,
                criticalPoint: lastSimulation.result.criticalPoint,
                safety: lastSimulation.result.safety,
                recommendation: lastSimulation.result.recommendation
            },
            stability: stability,
            history: this.getHistoryStats()
        };
    }

    // Exporter les données de simulation en JSON
    exportData() {
        return JSON.stringify({
            currentWeight: this.currentWeight,
            history: this.simulationHistory,
            report: this.generateReport()
        }, null, 2);
    }

    // Importer des données de simulation
    importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            if (data.currentWeight) {
                this.currentWeight = data.currentWeight;
            }
            
            if (data.history && Array.isArray(data.history)) {
                this.simulationHistory = data.history;
            }

            return true;
        } catch (error) {
            console.error('Erreur lors de l\'import des données:', error);
            return false;
        }
    }

    // Réinitialiser le simulateur
    reset() {
        this.currentGeometry = null;
        this.currentPosition = null;
        this.currentWeight = 5.0;
        this.simulationHistory = [];
        this.isSimulating = false;
    }

    // Obtenir des suggestions d'amélioration
    getSuggestions(simulationResult) {
        const suggestions = [];

        if (simulationResult.safety === 'danger') {
            suggestions.push({
                type: 'critical',
                icon: '🔴',
                title: 'Modification urgente nécessaire',
                description: 'Le design actuel ne peut pas supporter le poids. Modifie la structure avant d\'imprimer.'
            });

            suggestions.push({
                type: 'solution',
                icon: '💡',
                title: 'Augmente l\'épaisseur',
                description: `La zone critique est : ${simulationResult.criticalPoint}. Essaie d\'augmenter l\'épaisseur de 2-3mm à cet endroit.`
            });

            suggestions.push({
                type: 'solution',
                icon: '🔧',
                title: 'Ajoute des renforts',
                description: 'Ajoute des nervures ou des renforts dans les zones faibles pour mieux répartir les contraintes.'
            });
        } else if (simulationResult.safety === 'warning') {
            suggestions.push({
                type: 'warning',
                icon: '🟡',
                title: 'Amélioration recommandée',
                description: 'Le design fonctionne mais pourrait être plus solide.'
            });

            suggestions.push({
                type: 'solution',
                icon: '💡',
                title: 'Renforce légèrement',
                description: `Renforce la zone : ${simulationResult.criticalPoint} pour plus de sécurité.`
            });
        } else {
            suggestions.push({
                type: 'success',
                icon: '🟢',
                title: 'Design validé',
                description: 'Ton support est solide ! Tu peux l\'imprimer en toute confiance.'
            });

            if (simulationResult.safetyFactor > 5) {
                suggestions.push({
                    type: 'optimization',
                    icon: '♻️',
                    title: 'Optimisation possible',
                    description: 'Ton design est très solide. Tu pourrais réduire légèrement l\'épaisseur pour économiser du plastique.'
                });
            }
        }

        return suggestions;
    }

    // Calculer le coût d'impression estimé
    estimatePrintCost(analysis, materialCostPerKg = 20) {
        // Volume en cm³
        const volumeCm3 = analysis.volume;
        
        // Densité du PLA : 1.25 g/cm³
        const density = 1.25;
        const weightGrams = volumeCm3 * density;
        const weightKg = weightGrams / 1000;
        
        // Coût du matériau
        const materialCost = weightKg * materialCostPerKg;
        
        // Temps d'impression estimé (très approximatif)
        const estimatedHours = (volumeCm3 / 1000) * 0.5; // Règle très simplifiée
        
        return {
            weight: weightGrams,
            cost: materialCost,
            estimatedTime: estimatedHours
        };
    }
}
