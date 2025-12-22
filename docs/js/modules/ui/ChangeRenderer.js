export class ChangeRenderer {
    constructor(regionMapper) {
        this.regionMapper = regionMapper;
    }

    renderChangeItemDetailed(change) {
        const changeTypeClass = change.type.replace('_', '-');
        const changeTypeLabel = this.formatChangeType(change.type);
        const regionDisplay = this.regionMapper.getRegionDisplayName(change.region || '');
        const uniqueId = `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        if (change.type === 'ip_changes') {
            const addedCount = change.added_count || 0;
            const removedCount = change.removed_count || 0;
            const addedPrefixes = change.added_prefixes || [];
            const removedPrefixes = change.removed_prefixes || [];

            const showAddedIPs = addedPrefixes.length > 0;
            const showRemovedIPs = removedPrefixes.length > 0;
            const showBoth = showAddedIPs && showRemovedIPs;
            
            // Format combined list for copy all
            let allIPs = [];
            if (showBoth) {
                allIPs.push("=== Added IPs ===");
                allIPs.push(...addedPrefixes);
                allIPs.push(""); // Empty line separator
                allIPs.push("=== Removed IPs ===");
                allIPs.push(...removedPrefixes);
            } else {
                allIPs = [...addedPrefixes, ...removedPrefixes];
            }

            return `
                <div class="change-item detailed ${changeTypeClass}">
                    <div class="change-header">
                        <div class="change-service">
                            <strong>${change.service}</strong>
                            <span class="change-region">${regionDisplay}</span>
                        </div>
                        <div class="change-type-badge">${changeTypeLabel}</div>
                    </div>
                    <div class="change-details">
                        <div class="change-summary">
                            <span class="change-stat added">➕ ${addedCount} IPs added</span>
                            <span class="change-stat removed">➖ ${removedCount} IPs removed</span>
                        </div>
                        ${this.renderIPList(addedPrefixes, 'added', uniqueId, `added IPs for ${change.service}`)}
                        ${this.renderIPList(removedPrefixes, 'removed', uniqueId, `removed IPs for ${change.service}`)}
                        ${showBoth ? `
                            <div class="ip-copy-actions" style="margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
                                <button class="copy-btn-small copy-ips-btn" data-ips="${this.escapeForDataAttr(JSON.stringify(allIPs))}" data-label="all changed IPs (added & removed) for ${this.escapeForDataAttr(change.service)}">
                                    📋 Copy All Changed IPs (Added & Removed)
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        } else {
            // Service added/removed
            const prefixes = change.prefixes || [];
            const showPrefixes = prefixes.length > 0;
            
            const isRemoval = change.type === 'service_removed' || change.type === 'RemovedService';
            const listType = isRemoval ? 'removed' : 'added';
            const listLabel = isRemoval ? `IPs for removed service ${change.service}` : `IPs for new service ${change.service}`;

            return `
                <div class="change-item detailed ${changeTypeClass}">
                    <div class="change-header">
                        <div class="change-service">
                            <strong>${change.service}</strong>
                            <span class="change-region">${regionDisplay}</span>
                        </div>
                        <div class="change-type-badge">${changeTypeLabel}</div>
                    </div>
                    <div class="change-details">
                        ${change.ip_count ? `<p>${change.ip_count} IP ranges</p>` : ''}
                        ${change.system_service ? `<p>System Service: ${change.system_service}</p>` : ''}
                        
                        ${showPrefixes ? this.renderIPList(prefixes, listType, uniqueId, listLabel) : ''}
                    </div>
                </div>
            `;
        }
    }

    renderIPList(ips, type, uniqueId, label) {
        if (!ips || ips.length === 0) return '';
        
        const collapseThreshold = 10;
        const className = type === 'added' ? 'added-ip' : 'removed-ip';
        const sectionTitle = type === 'added' ? 'Added IPs:' : 'Removed IPs:';
        const copyLabel = type === 'added' ? 'Copy All Added' : 'Copy All Removed';
        
        return `
            <div class="ip-list-section">
                <div class="ip-section-title">
                    <strong>${sectionTitle}</strong>
                </div>
                <div class="ip-list-styled">
                    ${ips.slice(0, collapseThreshold).map(ip => `<div class="ip-item ${className}">${ip}</div>`).join('')}
                    ${ips.length > collapseThreshold ? `
                        <div class="ip-hidden" id="${type}-${uniqueId}" style="display:none;">
                            ${ips.slice(collapseThreshold).map(ip => `<div class="ip-item ${className}">${ip}</div>`).join('')}
                        </div>
                        <button class="show-more-btn" onclick="dashboard.changeRenderer.constructor.toggleIPs('${type}-${uniqueId}', this)">
                            ➕ Show ${ips.length - collapseThreshold} more
                        </button>
                    ` : ''}
                </div>
                <div class="ip-copy-actions">
                    <button class="copy-btn-small copy-ips-btn" data-ips="${this.escapeForDataAttr(JSON.stringify(ips))}" data-label="${this.escapeForDataAttr(label)}">
                        📋 ${copyLabel}
                    </button>
                </div>
            </div>
        `;
    }

    formatChangeType(type) {
        switch (type) {
            case 'NewService': return 'New Service';
            case 'RemovedService': return 'Removed Service';
            case 'ip_changes': return 'IP Changes';
            default: return type.replace(/_/g, ' ');
        }
    }

    escapeForDataAttr(str) {
        if (!str) return '';
        return str.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    copyIPsToClipboard(ips, label) {
        if (!ips || !Array.isArray(ips) || ips.length === 0) {
            this.showCopyFeedback('error', 'No IPs to copy');
            return;
        }

        const text = ips.join('\n');
        
        // Calculate actual IP count by excluding headers and empty lines
        const count = ips.filter(line => !line.startsWith('===') && line.trim() !== '').length;

        navigator.clipboard.writeText(text).then(() => {
            this.showCopyFeedback('success', `Copied ${count} IPs for ${label}`);
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.showCopyFeedback('error', 'Failed to copy to clipboard');
        });
    }

    showCopyFeedback(type, message) {
        const feedback = document.createElement('div');
        feedback.className = `copy-feedback ${type}`;
        feedback.textContent = message;
        
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.style.opacity = '0';
            feedback.style.transform = 'translateX(100%)';
            feedback.style.transition = 'all 0.3s ease';
            setTimeout(() => feedback.remove(), 300);
        }, 3000);
    }

    // Static helper for toggleIPs since it's called via onclick string
    static toggleIPs(elementId, button) {
        const element = document.getElementById(elementId);
        if (element) {
            const isHidden = element.style.display === 'none';
            element.style.display = isHidden ? 'block' : 'none';
            button.innerHTML = isHidden ? '➖ Show Less' : `➕ Show More`;
        }
    }
}
