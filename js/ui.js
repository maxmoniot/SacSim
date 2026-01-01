// Gestionnaire d'interface utilisateur
class UIManager {
    constructor(app) {
        this.app = app;
        this.toastContainer = document.getElementById('toastContainer');
        this.toastQueue = [];
        this.maxToasts = 3;
    }

    showToast(title, message, type = 'info') {
        // Limiter le nombre de toasts visibles
        if (this.toastQueue.length >= this.maxToasts) {
            const oldestToast = this.toastQueue.shift();
            oldestToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type]}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
        `;

        this.toastContainer.appendChild(toast);
        this.toastQueue.push(toast);

        // Auto-suppression après 2.5 secondes
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                toast.remove();
                const index = this.toastQueue.indexOf(toast);
                if (index > -1) {
                    this.toastQueue.splice(index, 1);
                }
            }, 300);
        }, 2500);

        // Permettre de fermer en cliquant
        toast.addEventListener('click', () => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                toast.remove();
                const index = this.toastQueue.indexOf(toast);
                if (index > -1) {
                    this.toastQueue.splice(index, 1);
                }
            }, 300);
        });
    }

    showLoading(message = 'Chargement...') {
        const loading = document.getElementById('loadingScreen');
        loading.querySelector('p').textContent = message;
        loading.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loadingScreen').classList.add('hidden');
    }

    updateProgress(percent, message) {
        // Pour futures améliorations avec barre de progression
        console.log(`Progress: ${percent}% - ${message}`);
    }

    showConfirm(title, message, onConfirm, onCancel) {
        // Utiliser confirm natif pour le moment
        // Peut être amélioré avec un modal personnalisé
        if (confirm(`${title}\n\n${message}`)) {
            if (onConfirm) onConfirm();
        } else {
            if (onCancel) onCancel();
        }
    }

    enableButton(buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = false;
        }
    }

    disableButton(buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.disabled = true;
        }
    }

    setButtonLoading(buttonId, loading = true) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        if (loading) {
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = '<span class="spinner" style="width: 20px; height: 20px; margin: 0 auto;"></span>';
            button.disabled = true;
        } else {
            button.innerHTML = button.dataset.originalText || button.innerHTML;
            button.disabled = false;
        }
    }

    highlightElement(elementId, duration = 2000) {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.style.animation = 'highlight 0.5s ease';
        setTimeout(() => {
            element.style.animation = '';
        }, duration);
    }

    scrollToElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Animation CSS pour highlight (à ajouter dynamiquement si nécessaire)
const style = document.createElement('style');
style.textContent = `
    @keyframes highlight {
        0%, 100% { background-color: transparent; }
        50% { background-color: rgba(76, 175, 80, 0.3); }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
