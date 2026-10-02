(() => {
    'use strict';

    const originalPreviews = new WeakMap();
    const previewUrls = new Map();

    // Calculate in integer cents so large DecimalField values keep their precision.
    const cents = (value) => {
        const normalized = value.trim().replace(',', '.');
        if (!normalized) return 0n;
        const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d{0,2}))?$/);
        if (!match) return null;
        const amount = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'));
        return match[1] === '-' ? -amount : amount;
    };

    const formatMoney = (amount) => {
        if (amount === null) return '—';
        const absolute = amount < 0n ? -amount : amount;
        const integer = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
        const fraction = (absolute % 100n).toString().padStart(2, '0');
        return `${amount < 0n ? '−' : ''}${integer},${fraction}\u00a0₽`;
    };

    function updateMoney() {
        const output = document.querySelector('[data-money-total]');
        if (!output) return;
        const fields = document.querySelector('#id_cards') ? ['cards', 'spb', 'cash'] : ['amount'];
        let total = 0n;
        for (const name of fields) {
            const input = document.querySelector(`#id_${name}`);
            // Read-only admin views keep the total rendered by Django.
            if (!input) return;
            const amount = cents(input.value);
            const breakdown = document.querySelector(`[data-money-field="${name}"]`);
            if (breakdown) breakdown.textContent = formatMoney(amount);
            total = total === null || amount === null ? null : total + amount;
        }
        output.textContent = formatMoney(total);
    }

    function updatePhotos() {
        previewUrls.forEach((url, preview) => {
            if (!preview.isConnected) {
                URL.revokeObjectURL(url);
                previewUrls.delete(preview);
            }
        });
        const group = document.querySelector('.reports-photos');
        if (!group) return;
        const rows = group.querySelectorAll('.inline-related:not(.empty-form)');
        let count = 0;
        rows.forEach((row) => {
            const deleted = row.querySelector('input[name$="-DELETE"]')?.checked || false;
            row.classList.toggle('reports-photo-deleted', deleted);
            if (!deleted && (row.dataset.hasPhoto === 'true' || row.querySelector('input[type="file"]')?.files.length)) count++;
        });
        const counter = group.querySelector('[data-photo-counter]');
        counter.textContent = `Фотографий: ${count}`;
        counter.hidden = false;
        const addButton = group.querySelector('.add-row a');
        if (addButton) addButton.textContent = 'Добавить фотографию';
    }

    function previewPhoto(input) {
        const row = input.closest('.inline-related');
        if (!row) return;
        const preview = row.querySelector('.reports-photo-preview');
        if (!originalPreviews.has(preview)) {
            originalPreviews.set(preview, [...preview.childNodes].map(node => node.cloneNode(true)));
        }
        if (previewUrls.has(preview)) {
            URL.revokeObjectURL(previewUrls.get(preview));
            previewUrls.delete(preview);
        }
        const file = input.files[0];
        if (!file) {
            preview.replaceChildren(...originalPreviews.get(preview).map(node => node.cloneNode(true)));
            return;
        }
        const image = document.createElement('img');
        image.alt = file.name;
        image.width = 320;
        image.height = 200;
        const url = URL.createObjectURL(file);
        previewUrls.set(preview, url);
        image.src = url;
        preview.replaceChildren(image);
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateMoney();
        const photoGrid = document.querySelector('.reports-photo-grid');
        if (photoGrid) {
            // Django creates the add link asynchronously after DOMContentLoaded.
            new MutationObserver(updatePhotos).observe(photoGrid, {childList: true});
            updatePhotos();
        }
        document.addEventListener('input', (event) => {
            if (['id_cards', 'id_spb', 'id_cash', 'id_amount'].includes(event.target.id)) updateMoney();
        });
        document.addEventListener('change', (event) => {
            if (!event.target.closest('.reports-photos')) return;
            if (event.target.type === 'file') previewPhoto(event.target);
            updatePhotos();
        });
        document.addEventListener('formset:added', updatePhotos);
        document.addEventListener('formset:removed', updatePhotos);
    });
})();
