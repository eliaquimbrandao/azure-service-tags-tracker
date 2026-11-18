// Static service tag pages: copy buttons, back-to-top, /tag/ index filter. Pages work without it.
{
    document.addEventListener('click', e => {
        const btn = e.target.closest('[data-copy]');
        if (!btn) return;
        navigator.clipboard.writeText(document.getElementById(btn.dataset.copy).textContent).then(
            () => { btn.textContent = '✅ Copied'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500); },
            () => { btn.textContent = '⚠️ Copy failed'; });
    });

    const toTop = document.querySelector('.to-top');
    if (toTop) addEventListener('scroll', () => toTop.classList.toggle('visible', scrollY > 600), { passive: true });

    const filter = document.getElementById('tagFilter');
    if (filter) {
        const families = [...document.querySelectorAll('details.family')];
        const count = document.getElementById('filterCount');
        filter.addEventListener('input', () => {
            const q = filter.value.trim().toLowerCase();
            let shown = 0;
            for (const fam of families) {
                let hits = 0;
                for (const row of fam.querySelectorAll('tbody tr')) {
                    const match = !q || row.textContent.toLowerCase().includes(q);
                    row.hidden = !match;
                    hits += match;
                }
                fam.hidden = !hits;
                fam.open = Boolean(q) && hits > 0;
                shown += hits;
            }
            count.textContent = q ? `${shown.toLocaleString()} matching tag${shown === 1 ? '' : 's'}` : '';
        });
    }

    // /tag/#f-Storage opens that service's card.
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target instanceof HTMLDetailsElement) target.open = true;
}
