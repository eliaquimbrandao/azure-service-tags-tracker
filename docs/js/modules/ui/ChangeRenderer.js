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

            // Split into IPv4 and IPv6
            const addedIPv4 = addedPrefixes.filter(ip => !ip.includes(':'));
            const addedIPv6 = addedPrefixes.filter(ip => ip.includes(':'));
            const removedIPv4 = removedPrefixes.filter(ip => !ip.includes(':'));
            const removedIPv6 = removedPrefixes.filter(ip => ip.includes(':'));

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

            // Build added section with IPv4/IPv6 split
            let addedHtml = '';
            if (showAddedIPs) {
                if (addedIPv4.length > 0) {
                    addedHtml += this.renderIPList(addedIPv4, 'added-ipv4', uniqueId, `added IPv4 for ${change.service}`);
                }
                if (addedIPv6.length > 0) {
                    addedHtml += this.renderIPList(addedIPv6, 'added-ipv6', uniqueId, `added IPv6 for ${change.service}`);
                }
            }

            // Build removed section with IPv4/IPv6 split
            let removedHtml = '';
            if (showRemovedIPs) {
                if (removedIPv4.length > 0) {
                    removedHtml += this.renderIPList(removedIPv4, 'removed-ipv4', uniqueId, `removed IPv4 for ${change.service}`);
                }
                if (removedIPv6.length > 0) {
                    removedHtml += this.renderIPList(removedIPv6, 'removed-ipv6', uniqueId, `removed IPv6 for ${change.service}`);
                }
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
                        ${addedHtml}
                        ${removedHtml}
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
            const baseType = isRemoval ? 'removed' : 'added';

            // Split into IPv4 and IPv6
            const ipv4Prefixes = prefixes.filter(ip => !ip.includes(':'));
            const ipv6Prefixes = prefixes.filter(ip => ip.includes(':'));

            let prefixHtml = '';
            if (showPrefixes) {
                if (ipv4Prefixes.length > 0) {
                    prefixHtml += this.renderIPList(ipv4Prefixes, `${baseType}-ipv4`, uniqueId, `${isRemoval ? 'removed' : 'added'} IPv4 for ${change.service}`);
                }
                if (ipv6Prefixes.length > 0) {
                    prefixHtml += this.renderIPList(ipv6Prefixes, `${baseType}-ipv6`, uniqueId, `${isRemoval ? 'removed' : 'added'} IPv6 for ${change.service}`);
                }
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
                        ${change.ip_count ? `<p>${change.ip_count} IP ranges</p>` : ''}
                        ${change.system_service ? `<p>System Service: ${change.system_service}</p>` : ''}
                        
                        ${prefixHtml}
                    </div>
                </div>
            `;
        }
    }

    renderIPList(ips, type, uniqueId, label) {
        if (!ips || ips.length === 0) return '';
        
        const collapseThreshold = 10;
        const classMap = {
            added: 'added-ip', removed: 'removed-ip', active: 'added-ip',
            ipv4: 'added-ip', ipv6: 'added-ip',
            'added-ipv4': 'added-ip', 'added-ipv6': 'added-ip',
            'removed-ipv4': 'removed-ip', 'removed-ipv6': 'removed-ip'
        };
        const titleMap = {
            added: 'Added IPs:', removed: 'Removed IPs:', active: 'Active IP Ranges:',
            ipv4: 'IPv4 Ranges:', ipv6: 'IPv6 Ranges:',
            'added-ipv4': 'Added IPv4:', 'added-ipv6': 'Added IPv6:',
            'removed-ipv4': 'Removed IPv4:', 'removed-ipv6': 'Removed IPv6:'
        };
        const copyMap = {
            added: 'Copy All Added', removed: 'Copy All Removed', active: 'Copy All IPs',
            ipv4: 'Copy IPv4', ipv6: 'Copy IPv6',
            'added-ipv4': 'Copy Added IPv4', 'added-ipv6': 'Copy Added IPv6',
            'removed-ipv4': 'Copy Removed IPv4', 'removed-ipv6': 'Copy Removed IPv6'
        };
        const className = classMap[type] || 'added-ip';
        const sectionTitle = titleMap[type] || 'IP Ranges:';
        const copyLabel = copyMap[type] || 'Copy All';
        
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
