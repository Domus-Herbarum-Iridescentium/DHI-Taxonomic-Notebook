console.log("[DHI] utils.js loaded");

const DB_NAME = 'TaxonomyImages';
const STORE_NAME = 'images';
let db = null;
let _dbErrorShown = false;

// 图片工具
function generateUUID() {
    return 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 辅助：压缩图片（返回 Blob）
function compressImage(blob, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let w = img.width,
                h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = h * maxSize / w;
                    w = maxSize; } else { w = w * maxSize / h;
                    h = maxSize; }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(function(blob) {
                resolve(blob);
            }, 'image/jpeg', quality);
            URL.revokeObjectURL(url);
        };
        img.onerror = function() {
            URL.revokeObjectURL(url);
            reject('图片加载失败');
        };
        img.src = url;
    });
}

function setImageBlob(imgElement, blob, fallbackSrc, fallbackObjectFit) {
    if (!imgElement) return;

    if (imgElement._blobURL) {
        URL.revokeObjectURL(imgElement._blobURL);
        imgElement._blobURL = null;
    }

    if (blob) {
        const url = URL.createObjectURL(blob);
        imgElement.src = url;
        imgElement._blobURL = url;
        imgElement.style.objectFit = 'cover';
    } else {
        const fallback = fallbackSrc ||
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140"%3E%3Crect fill="%23f0f2f5" width="200" height="140"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="%23999" text-anchor="middle" dy=".3em"%E5%9B%BE%E7%89%87%E4%B8%8D%E5%AD%98%E5%9C%A8%3C/text%3E%3C/svg%3E';
        imgElement.src = fallback;
        imgElement._blobURL = null;
        imgElement.style.objectFit = fallbackObjectFit || 'contain';
    }
}

function cleanupBlobURLs(root) {
    if (!root) return;
    root.querySelectorAll('[data-img-uuid], .img-preview').forEach(el => {
        if (el._blobURL) {
            URL.revokeObjectURL(el._blobURL);
            el._blobURL = null;
        }
    });
}

// Markdown
function renderMarkdown(text) {
    if (!text) return '';
    const rawHtml = marked.parse(text);
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(rawHtml);
    }
    console.error('[DHI] DOMPurify not loaded, falling back to escaped plain text.');
    return escapeHtml(text);
}

// 文本解析
function parseImageField(text) {
    const lines = text.split('\n').filter(s => s.trim());
    return lines.map(line => {
        const parts = line.split('|');
        let src = parts[0].trim();
        let caption = parts[1] ? parts[1].trim() : '';
        const isRef = src.startsWith('[img:');
        let uuid = '';
        if (isRef) {
            uuid = src.replace('[img:', '').replace(']', '');
        }
        return { src, caption, isImageRef: isRef, uuid: uuid };
    });
}

//学名解析及渲染

function extractCultivarSegment(raw) {
    const LEFT_CURLY = '‘';
    const RIGHT_CURLY = '’';
    const STRAIGHT = "'";

    function isValidBoundary(start, end) {
        const leftOk = (start === 0 || raw[start - 1] === ' ');
        const rightOk = (end === raw.length - 1 || raw[end + 1] === ' ');
        return leftOk && rightOk;
    }

    // 1) 弯引号
    let idx = raw.indexOf(LEFT_CURLY);
    while (idx !== -1) {
        const rightIdx = raw.indexOf(RIGHT_CURLY, idx + 1);
        if (rightIdx !== -1) {
            const content = raw.substring(idx + 1, rightIdx);
            if (content.length > 0 && isValidBoundary(idx, rightIdx)) {
                return {
                    text: LEFT_CURLY + content + RIGHT_CURLY,
                    start: idx,
                    end: rightIdx
                };
            }
        }
        idx = raw.indexOf(LEFT_CURLY, idx + 1);
    }

    // 2) 直引号（贪婪匹配第一个到最后一个）
    const firstIdx = raw.indexOf(STRAIGHT);
    if (firstIdx !== -1) {
        const lastIdx = raw.lastIndexOf(STRAIGHT);
        if (lastIdx > firstIdx) {
            const content = raw.substring(firstIdx + 1, lastIdx);
            if (content.length > 0 && isValidBoundary(firstIdx, lastIdx)) {
                return {
                    text: LEFT_CURLY + content + RIGHT_CURLY,
                    start: firstIdx,
                    end: lastIdx
                };
            }
        }
    }

    return null;
}

function parseScientificName(input) {
    const originalRaw = input.trim();
    let raw = originalRaw;
    if (!raw) return { scientificName: '', author: '', raw, confidence: 'low', parsed: false };

    const cultivarInfo = extractCultivarSegment(raw);
    if (cultivarInfo) {
        const before = raw.substring(0, cultivarInfo.start).trim();
        const after = raw.substring(cultivarInfo.end + 1).trim();
        let scientificName = before;
        if (scientificName) {
            scientificName = scientificName + ' ' + cultivarInfo.text;
        } else {
            scientificName = cultivarInfo.text;
        }
        return { 
            scientificName, 
            author: after, 
            raw: originalRaw, 
            confidence: 'high', 
            parsed: true 
        };
    }

    // ---------- 预处理：乘号与后续字母之间插入空格 ----------
    raw = raw.replace(/(^|\s)(×)(?=[A-Za-z])/g, '$1$2 ');

    // ---------- 1. 分离 " in " 文献引用 ----------
    let citation = '';
    let mainTokens = raw.split(/\s+/).filter(t => t.length > 0);
    const inIdx = mainTokens.findIndex(t => t.toLowerCase() === 'in');
    if (inIdx !== -1 && inIdx < mainTokens.length - 1) {
        const after = mainTokens.slice(inIdx + 1);
        if (after.some(t => /^[A-Z]/.test(t) || /^\d/.test(t))) {
            citation = after.join(' ');
            mainTokens = mainTokens.slice(0, inIdx);
        }
    }

    // ---------- 2. 辅助定义 ----------
    const ranks = new Set(['subsp.', 'ssp.', 'var.', 'f.', 'forma', 'subvar.', 'subsp', 'ssp', 'var', 'f', 'forma', 'subvar']);
    const modifiers = new Set(['cf.', 'aff.', 'sp.', 'cf', 'aff', 'sp', '?']);
    const connectives = new Set(['ex', 'et', '&']);
    const particles = new Set([
        'van', 'von', 'de', 'der', 'la', 'le', 'du', 'des', 'del',
        'ten', 'ter', 'den', 'da', 'do', 'dos', 'das', 'della', 'delle'
    ]);

    const isRank = t => ranks.has(t) || ranks.has(t.toLowerCase());
    const isModifier = t => modifiers.has(t) || modifiers.has(t.toLowerCase());
    const isEpithet = t => /^[a-z]/.test(t) && !isRank(t) && !isModifier(t) && !connectives.has(t.toLowerCase()) && !particles.has(t.toLowerCase());
    const isAuthorLike = t => /^[A-Z]/.test(t) || /[()]/.test(t) || /^\d/.test(t);
    const isHybrid = t => t === '×';

    // ---------- 3. 核心解析 ----------
    let scientificName = '';
    let author = '';

    // 检查是否存在等级词
    const rankIdx = mainTokens.findIndex(t => isRank(t));

    if (rankIdx !== -1) {
        // ---- 存在等级词：等级词之前全部为学名，等级词及之后按规则处理 ----
        const sciParts = mainTokens.slice(0, rankIdx); // 等级词之前
        sciParts.push(mainTokens[rankIdx]); // 等级词本身
        let i = rankIdx + 1;
        // 继续收集等级词之后的学名部分（种下加词、修饰词、后续等级词等）
        while (i < mainTokens.length) {
            const token = mainTokens[i];
            if (isRank(token) || isModifier(token) || isEpithet(token) || isHybrid(token)) {
                sciParts.push(token);
                i++;
            } else {
                // 遇到作者特征或连接词，则结束学名收集，剩余为作者
                break;
            }
        }
        // 剩余部分为作者（包括连接词等）
        const authorParts = mainTokens.slice(i);
        scientificName = sciParts.join(' ');
        author = authorParts.join(' ');
    } else {
        // ---- 无等级词：使用精细的角色标注逻辑 ----
        const tokens = mainTokens;
        const roles = [];
        let i = 0;
        const len = tokens.length;

        // 杂交符号开头
        if (i < len && isHybrid(tokens[i])) {
            roles.push({ token: tokens[i], role: 'sci' });
            i++;
        }

        // 必须有属名
        if (i < len && /^[A-Z]/.test(tokens[i]) && !isRank(tokens[i]) && !isModifier(tokens[i]) && !connectives.has(tokens[i].toLowerCase())) {
            roles.push({ token: tokens[i], role: 'sci' });
            i++;
        } else {
            // 回退：整个字符串作为学名
            return { scientificName: raw, author: '', raw, confidence: 'low', parsed: false };
        }

        // 种加词（可选）
        if (i < len && isEpithet(tokens[i])) {
            roles.push({ token: tokens[i], role: 'sci' });
            i++;
        }

        while (i < len) {
            const token = tokens[i];
            const lower = token.toLowerCase();

            // 介词 → 作者及之后
            if (particles.has(lower)) {
                roles.push({ token, role: 'author' });
                i++;
                while (i < len) {
                    roles.push({ token: tokens[i], role: 'author' });
                    i++;
                }
                break;
            }

            // 等级词
            if (isRank(token)) {
                if (i + 1 < len && isEpithet(tokens[i + 1])) {
                    roles.push({ token, role: 'sci' });
                    i++;
                    roles.push({ token: tokens[i], role: 'sci' });
                    i++;
                } else {
                    roles.push({ token, role: 'author' });
                    i++;
                }
                continue;
            }

            // 修饰词
            if (isModifier(token)) {
                roles.push({ token, role: 'sci' });
                i++;
                continue;
            }

            // 连接词 → 作者及之后
            if (connectives.has(lower)) {
                roles.push({ token, role: 'author' });
                i++;
                while (i < len) {
                    roles.push({ token: tokens[i], role: 'author' });
                    i++;
                }
                break;
            }

            // 杂交符号
            if (isHybrid(token)) {
                roles.push({ token, role: 'sci' });
                i++;
                continue;
            }

            // 大写/括号/数字 → 作者
            if (/^[A-Z]/.test(token) || /[()]/.test(token) || /^\d/.test(token)) {
                roles.push({ token, role: 'author' });
                i++;
                continue;
            }

            // 小写有效种下加词 → 学名
            if (isEpithet(token)) {
                roles.push({ token, role: 'sci' });
                i++;
                continue;
            }

            // 其他 → 作者
            roles.push({ token, role: 'author' });
            i++;
        }

        scientificName = roles.filter(r => r.role === 'sci').map(r => r.token).join(' ');
        author = roles.filter(r => r.role === 'author').map(r => r.token).join(' ');
    }

    // ---------- 4. 附加引文到作者 ----------
    if (citation) {
        author = (author ? author + ' in ' : 'in ') + citation;
    }

    // ---------- 5. 可信度计算 ----------
    const sciTokens = scientificName.split(/\s+/);
    const meaningful = sciTokens.filter(t => !isRank(t) && !isModifier(t) && t !== '×' && !connectives.has(t.toLowerCase())).length;
    const parsed = author.length > 0;
    let confidence = 'low';
    if (parsed && meaningful >= 2) confidence = 'high';
    else if (!parsed && meaningful >= 2) confidence = 'medium';

    // ========== 保存原始输入 ==========
    return { scientificName, author, raw: originalRaw, confidence, parsed };
}

// rank&modifier显示正体
function formatScientificNameWithAuthor(scientificName, author) {
    if (!scientificName) return '';

    let cultivar = '';
    let remaining = scientificName;
    const match = scientificName.match(/([‘][^’]+[’])/);
    if (match) {
        cultivar = match[1];
        remaining = scientificName.replace(cultivar, '').trim();
    }
    const tokens = remaining.split(/\s+/).filter(t => t.length > 0);

    const ranks = new Set([
        'subsp.', 'ssp.', 'var.', 'f.', 'forma', 'subvar.',
        'subsp', 'ssp', 'var', 'f', 'forma', 'subvar'
    ]);
    const modifiers = new Set(['cf.', 'aff.', 'sp.', 'cf', 'aff', 'sp', '?']);
    const connectives = new Set(['ex', 'et', '&']);  // 新增连接词

    function isRank(token) {
        const lower = token.toLowerCase();
        const clean = lower.replace(/\.$/, '');
        return ranks.has(lower) || ranks.has(clean);
    }
    function isModifier(token) {
        const lower = token.toLowerCase();
        const clean = lower.replace(/\.$/, '');
        return modifiers.has(lower) || modifiers.has(clean);
    }
    function isAuthorLike(token) {
        return /^[A-Z]/.test(token) || /[()]/.test(token) || /^\d/.test(token);
    }
    function isConnective(token) {
        return connectives.has(token.toLowerCase());
    }

    // 从右向左提取命名人起始索引（包含连接词）
    function extractAuthorStart(tokens, start, end) {
        let i = end;
        while (i >= start) {
            const token = tokens[i];
            if (isAuthorLike(token) || isConnective(token)) {
                i--;
            } else {
                // 遇到等级词或修饰词 → 停止
                if (isRank(token) || isModifier(token)) break;
                // 遇到小写且非等级/修饰词 → 可能是种加词，停止
                if (/^[a-z]/.test(token) && !isRank(token) && !isModifier(token)) break;
                // 其他（标点等）也视为停止
                break;
            }
        }
        return i + 1;
    }

    // 查找等级词位置
    let rankIndex = -1;
    for (let i = 0; i < tokens.length; i++) {
        if (isRank(tokens[i])) {
            rankIndex = i;
            break;
        }
    }

    const parts = [];
    if (rankIndex !== -1) {
        // ----- 存在等级词 -----
        const beforeRank = tokens.slice(0, rankIndex);
        const afterRank = tokens.slice(rankIndex + 1);
        // 提取 beforeRank 中的命名人起始
        const authorStart = extractAuthorStart(beforeRank, 0, beforeRank.length - 1);

        // 等级词之前：学名部分（斜体）
        for (let i = 0; i < authorStart; i++) {
            const token = beforeRank[i];
            if (isRank(token) || isModifier(token)) {
                parts.push(escapeHtml(token));
            } else {
                parts.push(`<i>${escapeHtml(token)}</i>`);
            }
        }
        // 命名人部分（正体）
        for (let i = authorStart; i < beforeRank.length; i++) {
            parts.push(escapeHtml(beforeRank[i]));
        }
        // 等级词（正体）
        parts.push(escapeHtml(tokens[rankIndex]));
        // 等级词之后：种下加词（斜体）及可能的修饰词（正体）
        const afterAuthorStart = extractAuthorStart(tokens, rankIndex + 1, tokens.length - 1);
        for (let i = rankIndex + 1; i < tokens.length; i++) {
            const token = tokens[i];
            if (isRank(token) || isModifier(token)) {
                parts.push(escapeHtml(token));
            } else if (i < afterAuthorStart) {
                parts.push(`<i>${escapeHtml(token)}</i>`);
            } else {
                parts.push(escapeHtml(token));  // 作者部分正体
            }
        }
    } else {
        // ----- 无等级词 -----
        const authorStart = extractAuthorStart(tokens, 0, tokens.length - 1);
        for (let i = 0; i < authorStart; i++) {
            const token = tokens[i];
            if (isRank(token) || isModifier(token)) {
                parts.push(escapeHtml(token));
            } else {
                parts.push(`<i>${escapeHtml(token)}</i>`);
            }
        }
        for (let i = authorStart; i < tokens.length; i++) {
            parts.push(escapeHtml(tokens[i]));
        }
    }

    let html = parts.join(' ');

    if (cultivar) {
        html += ' ' + escapeHtml(cultivar);
    }

    if (author) {
        html += ' ' + escapeHtml(author);
    }
    return html;
}

function parseAnnotatedText(input) {
    if (!input || typeof input !== 'string') {
        return { text: '', link: '' };
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return { text: '', link: '' };
    }

    const separatorIndex = trimmed.indexOf('|');

    // 文本|链接
    if (separatorIndex !== -1) {
        const text = trimmed.slice(0, separatorIndex).trim();
        let link = trimmed.slice(separatorIndex + 1).trim();

        link = link.replace(/[。.,，；;]+$/, '');

        return {
            text,
            link
        };
    }

    // 纯 URL
    if (/^https?:\/\/\S+$/.test(trimmed)) {
        let link = trimmed.replace(/[。.,，；;]+$/, '');

        return {
            text: '',
            link
        };
    }

    // 普通文本
    return {
        text: trimmed,
        link: ''
    };
}

// 搜索专用
function formatScientificNameText(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    const parsed = parseScientificName(raw);
    if (parsed.scientificName) {
        return formatScientificNameWithAuthor(parsed.scientificName, parsed.author);
    }
    return raw; // 回退
}

function parseDistributionText(input) {
    if (!input || typeof input !== 'string') {
        return [];
    }
    const trimmed = input.trim();
    if (!trimmed) return [];

    // ---------- 第一步：按括号外的国家分隔符拆分成多个条目 ----------
    const rawParts = [];
    let currentPart = '';
    let inBracket = false;

    // 国家分隔符（仅当不在括号内时生效）
    const isCountrySeparator = (ch) => {
        return ch === '\n' || ch === '；' || ch === ';' || ch === '，' || ch === ',' || ch === '、';
    };

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];

        // 括号切换状态
        if (ch === '（' || ch === '(') {
            inBracket = true;
            currentPart += ch;
            continue;
        }
        if (ch === '）' || ch === ')') {
            inBracket = false;
            currentPart += ch;
            continue;
        }

        // 如果不在括号内且遇到国家分隔符，则结束当前条目
        if (!inBracket && isCountrySeparator(ch)) {
            if (currentPart.trim()) {
                rawParts.push(currentPart.trim());
            }
            currentPart = '';
            continue;
        }

        // 普通字符
        currentPart += ch;
    }

    // 最后一段
    if (currentPart.trim()) {
        rawParts.push(currentPart.trim());
    }

    // ---------- 第二步：解析每个条目（国家 + 地区） ----------
    const result = [];
    for (let part of rawParts) {
        part = part.trim();
        if (!part) continue;

        // 尝试匹配 "国家（地区）" 或 "国家 (地区)"
        let match = part.match(/^(.*?)[（(]\s*(.*?)\s*[）)]\s*$/);
        if (match) {
            const country = match[1].trim();
            const areasRaw = match[2].trim();
            // 地区分隔符：中文逗号、英文逗号、顿号
            const areas = areasRaw ? areasRaw.split(/[，,、]+/).map(s => s.trim()).filter(Boolean) : [];
            result.push({ country, areas });
        } else {
            // 无括号，整个作为国家
            result.push({ country: part, areas: [] });
        }
    }

    return result;
}

// ===== 格式化单个分布项为显示字符串 =====
function formatDistributionItem(item) {
    if (!item) return '';

    const country = item.country || '';
    const areas = Array.isArray(item.areas) ? item.areas : [];

    if (areas.length === 0) {
        return country;
    }

    return `${country}（${areas.join('，')}）`;
}

function parsePhenologyMonths(value) {
    if (!value || typeof value !== 'string') return [];

    const trimmed = value.trim();
    if (!trimmed) return [];

    // ---------- 第一步：移除跨年干扰词 ----------
    let cleaned = trimmed.replace(/(?:翌年|第二年|次年|来年|明年|下一年|隔年)/g, '');

    // ---------- 第二步：将非数字和非分隔符的字符替换为空格 ----------
    // 允许的字符：数字、-、~、－、～、至
    // 其他字符（包括中文、逗号、句号等）替换为空格
    const allowedChars = /[^0-9\-–—~－～至]/g;
    cleaned = cleaned.replace(allowedChars, ' ');

    // ---------- 第三步：合并连续空格，去除首尾空格 ----------
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // ---------- 第四步：检测“全年” ----------
    if (/全年/.test(trimmed)) {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }

    // ---------- 第五步：提取所有数字（离散月份） ----------
    const allNumbers = (cleaned.match(/\d+/g) || [])
        .map(Number)
        .filter(n => n >= 1 && n <= 12);

    // ---------- 第六步：提取区间 ----------
    const rangeMatches = [...cleaned.matchAll(/(\d+)\s*(?:[-–—~－～]|至)\s*(\d+)/g)];
    const orderedMonths = [];
    let hasCrossYear = false;

    for (const match of rangeMatches) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        if (start < 1 || start > 12 || end < 1 || end > 12) continue;

        if (start > end) {
            hasCrossYear = true;
            for (let m = start; m <= 12; m++) orderedMonths.push(m);
            for (let m = 1; m <= end; m++) orderedMonths.push(m);
        } else {
            for (let m = start; m <= end; m++) orderedMonths.push(m);
        }
    }

    // ---------- 第七步：合并离散数字（去重，保持顺序） ----------
    const existingSet = new Set(orderedMonths);
    for (const num of allNumbers) {
        if (!existingSet.has(num)) {
            orderedMonths.push(num);
            existingSet.add(num);
        }
    }

    // ---------- 第八步：去重保留顺序 ----------
    const unique = [];
    const seen = new Set();
    for (const num of orderedMonths) {
        if (!seen.has(num)) {
            unique.push(num);
            seen.add(num);
        }
    }

    return hasCrossYear ? unique : unique.sort((a, b) => a - b);
}

function parsePhenologyText(text) {
    if (!text || typeof text !== 'string') return [];

    // ---------- 第1步：分割条目 ----------
    // 先按换行、分号、逗号分割（英文或中文）
    const rawParts = text.split(/[；;，,|\n]+/).map(s => s.trim()).filter(Boolean);

    // 合并不含“期”的片段到前一个（保护复杂描述）
    const mergedParts = [];
    for (const part of rawParts) {
        if (!part) continue;
        if (mergedParts.length === 0) {
            mergedParts.push(part);
        } else {
            // 如果当前片段含有“期”字（花期、果期、物候期等），作为新条目
            if (/期/.test(part)) {
                mergedParts.push(part);
            } else {
                // 否则合并到前一个，用逗号连接
                mergedParts[mergedParts.length - 1] += '，' + part;
            }
        }
    }

    // ---------- 第2步：解析每个条目 ----------
    const result = [];
    const labelRegex = /^(花果期|花期|果期|萌芽期|结实期|生长期|休眠期|繁殖期|发生期|活动期|羽化期|迁飞期|迁徙期|春迁期|秋迁期|越冬期|子实体期|物候期|物候|花|果)/; // 可扩展

    for (let entry of mergedParts) {
        entry = entry.trim();
        if (!entry) continue;

        let label = '';
        let value = '';

        // 尝试匹配标签（开头）
        const match = entry.match(labelRegex);
        if (match) {
            label = match[1];
            value = entry.slice(match[0].length).trim();
        } else {
            // 没有标签，整段作为 value，label 设为“物候”
            label = '物候';
            value = entry;
        }

        // ---------- 第3步：清理 value ----------
        // 去除末尾标点（。；；，、等）
        value = value.replace(/[。；;，,、]+$/, '');

        // 如果 value 为空，但原 entry 有内容，可能全为标签，保留标签作为 value
        if (!value) {
            // 例如“花期”单独一行，则 value 设为空，months 为空
        }

        // ---------- 第4步：解析月份 ----------
        const months = parsePhenologyMonths(value);

        // 即使 months 为空（如“不详”），也保留条目
        result.push({
            label: label,
            value: value,
            months: months
        });
    }

    return result;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function renderAnnotatedText(item) {
    if (!item) return '';
    if (typeof item === 'string') return escapeHtml(item);
    const text = item.text || '';
    const link = item.link || '';
    if (link) {
        const safeLink = sanitizeUrl(link);
        if (safeLink) {
            return `<a href="${safeLink}" target="_blank" rel="noopener noreferrer">${escapeHtml(text || link)}</a>`;
        }
        // URL 不安全，降级为纯文本
        return escapeHtml(text || link);
    }
    return escapeHtml(text);
}

// ===== 匹配分布结构化数据，返回匹配的最小单元 =====
function matchDistribution(distribution, query) {
    if (!Array.isArray(distribution) || query === undefined || query === null) {
        return [];
    }

    const q = String(query).toLowerCase().trim();
    if (!q) return [];

    const results = [];

    for (const item of distribution) {
        const countryRaw = item.country || '';
        const country = countryRaw.toLowerCase();
        const areas = Array.isArray(item.areas) ? item.areas : [];

        // 情况1：国家匹配 → 返回该国家完整分布
        if (country.includes(q)) {
            results.push({
                country: countryRaw,
                areas: areas.slice()
            });
            continue;
        }

        // 情况2：地区匹配 → 仅返回命中的地区
        const matchedAreas = areas.filter(area =>
            typeof area === 'string' &&
            area.toLowerCase().includes(q)
        );

        if (matchedAreas.length > 0) {
            results.push({
                country: countryRaw,
                areas: matchedAreas
            });
        }
    }

    return results;
}

// ============================================================
// 🔒 HTML 安全工具
// ============================================================

/**
 * HTML 实体转义（用于文本内容）
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 安全 URL 验证（只允许 http/https 协议）
 */
function sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = url.trim();
    // 只允许 http:// 或 https:// 开头的 URL
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
        return trimmed;
    }
    // 允许相对路径（如 images/xxx.jpg）
    if (/^\/[^\/]/.test(trimmed) || /^[^/]/.test(trimmed) && !/^[a-z]+:/i.test(trimmed)) {
        return trimmed;
    }
    return '';
}

/**
 * 安全的属性值转义（用于 HTML 属性）
 */
function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// 导出markdown辅助
function downloadBlob(blob, fileName) {
    if (!(blob instanceof Blob)) {
        throw new Error('downloadBlob: invalid Blob.');
    }

    if (
        typeof fileName !== 'string' ||
        !fileName.trim()
    ) {
        throw new Error('downloadBlob: invalid file name.');
    }

    const url =
        URL.createObjectURL(blob);

    const a =
        document.createElement('a');

    a.href = url;
    a.download = fileName;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

// 结构化description描述
const KEYWORD_MAP = [
    { title: '托叶', patterns: [
        /^托叶/
    ]},
    { title: '叶', patterns: [
        /^叶(?!状)(片|柄|鞘)?/,
        /^(?!(落叶))[^，,、。\s]{1,3}叶/,
        /^[^，,、。\s]{2,10}复叶/,
        /^[^，,、。\s]{2,10}裂叶/
    ]},
    { title: '花序', patterns: [
        /^花序(轴|梗)?/,
        /^[^，,、。\s]{1,10}花序/,
        /^总花梗/,
        /^花莛/,
        /^花葶/
    ]},
    { title: '苞片', patterns: [
        /^苞片/,
        /^小苞片/,
        /^总苞/
    ]},
    { title: '花萼', patterns: [
        /^萼(片)?/,
        /^花萼/
    ]},
    { title: '花冠', patterns: [
        /^花冠/,
        /^花瓣/
    ]},
    { title: '雄蕊', patterns: [
        /^雄蕊/,
        /^花药/,
        /^花丝/
    ]},
    { title: '雌蕊', patterns: [
        /^雌蕊/,
        /^子房/,
        /^花柱/,
        /^柱头/,
        /^心皮/,
        /^胚珠/
    ]},
    { title: '果实', patterns: [
        /^[^，,、。\s]{0,4}果(?!期)/
    ]},
    { title: '种子', patterns: [
        /^种子/
    ]},
    { title: '茎', patterns: [
        /^[^，,、。\s]{0,2}茎(部|干)?/,
        /^枝条/,
        /^[^，,、。\s]{0,2}枝(条)?/
    ]},
    { title: '花', patterns: [
        /^[^，,、。\s]{0,2}花(?!萼|冠|期|果期)/
    ]},
    { title: '根', patterns: [
        /^(?!(假根))[^，,、。\s]{0,2}根(?!状|茎)/,
    ]}
];

function structureDescription(text) {
    if (!text || typeof text !== 'string') return text;

    const paragraphs = text.split(/\n+/).filter(p => p.trim() !== '');
    if (paragraphs.length === 0) return text;

    const result = [];

    for (let para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;

        // 已有 Markdown 粗体标题 + 冒号 → 跳过
        if (/^\*\*[^*]+\*\*[:：]/.test(trimmed)) {
            result.push(trimmed);
            continue;
        }

        const cleanStart = trimmed.replace(/^[\s，,、。.；;]+/, '');
        let matched = false;

        for (const entry of KEYWORD_MAP) {
            for (const pattern of entry.patterns) {
                const match = cleanStart.match(pattern);
                if (match) {
                    const matchedText = match[0];
                    const nextChar = cleanStart[matchedText.length];
                    // 如果后面紧跟冒号，视为已有标题 → 直接保留
                    if (nextChar === '：' || nextChar === ':') {
                        result.push(trimmed);
                        matched = true;
                        break;
                    }
                    result.push(`**${entry.title}：** ${trimmed}`);
                    matched = true;
                    break;
                }
            }
            if (matched) break;
        }

        if (!matched) {
            result.push(trimmed);
        }
    }

    return result.join('\n\n');
}

// 句号后换行
function applySentenceBreak(text) {
    if (!text || typeof text !== 'string') return text;

    let result = '';
    let i = 0;
    const len = text.length;

    while (i < len) {
        const ch = text[i];
        result += ch;

        // 如果是句子结束标点
        if (/[。]/.test(ch)) {
            // 检查下一个字符
            const next = i + 1 < len ? text[i + 1] : '';
            // 如果下一个字符不是换行、空格、标点、结尾，则插入换行
            if (next && !/[\s。，,、]/.test(next)) {
                result += '\n';
            }
        }
        i++;
    }

    return result;
}