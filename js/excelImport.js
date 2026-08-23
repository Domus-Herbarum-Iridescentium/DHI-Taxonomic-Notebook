console.log("[DHI] excelImport.js loaded");

const EXCEL_RANK_ALIASES = {
    '物种': 'species',
    '杂交种': 'nothospecies',
    '亚种': 'subspecies',
    '变种': 'variety',
    '变型': 'form',
    '品种': 'cultivar',
    '种': 'species'
};

function parseExcelRow(row, rowIndex) {
    const scientificNameRaw = (row['学名'] || row['scientificNameRaw'] || '').trim();
    const commonName = (row['中文俗名'] || row['commonName'] || '').trim();

    // 必填验证：至少一个非空
    if (!scientificNameRaw && !commonName) {
        throw new Error(`第 ${rowIndex} 行：学名与中文俗名均为空`);
    }

    // 解析 rank
    let rank = (row['等级'] || row['rank'] || '').trim();
    if (!rank) {
        rank = 'species';
    } else {
        // 先查别名映射
        const normalized = EXCEL_RANK_ALIASES[rank];
        if (normalized) {
            rank = normalized;
        }
        // 再检查是否在 TERMINAL_RANKS 中
        if (!TERMINAL_RANKS.includes(rank)) {
            throw new Error(`第 ${rowIndex} 行：等级 "${rank}" 无效，只支持 species/亚种/变种/变型/品种`);
        }
    }

    // 解析其他字段（直接复用现有 parser）
    const distribution = parseDistributionText(row['分布'] || row['distribution'] || '');
    const habitat = (row['生境'] || row['habitat'] || '').trim();
    const phenology = parsePhenologyText(row['物候'] || row['phenology'] || '');
    const localities = (row['点位记录'] || row['localities'] || '')
        .split('\n')
        .filter(s => s.trim())
        .map(line => {
            const parts = line.split('|');
            return { coordinate: parts[0]?.trim() || '', description: parts[1]?.trim() || '' };
        });
    const protologue = parseAnnotatedText(row['原始发表'] || row['protologue'] || '');
    const typeInformation = parseAnnotatedText(row['模式信息'] || row['typeInformation'] || '');
    const specimens = (row['标本'] || row['specimens'] || '')
        .split('\n')
        .filter(s => s.trim())
        .map(parseAnnotatedText);
    const references = (row['参考文献'] || row['references'] || '')
        .split('\n')
        .filter(s => s.trim())
        .map(parseAnnotatedText);
    const synonyms = (row['异名'] || row['synonyms'] || '')
        .split('\n')
        .filter(s => s.trim())
        .map(parseAnnotatedText);
    const diagnosis = (row['鉴定要点'] || row['diagnosis'] || '').trim();
    const description = (row['描述'] || row['description'] || '').trim();
    const etymology = (row['词源'] || row['etymology'] || '').trim();
    const discussion = (row['讨论'] || row['discussion'] || '').trim();

    // 注意：photos 列被忽略

    return {
        scientificNameRaw,
        commonName,
        rank,
        distribution,
        habitat,
        phenology,
        localities,
        protologue,
        typeInformation,
        specimens,
        references,
        synonyms,
        diagnosis,
        description,
        etymology,
        discussion
    };
}

async function importExcelFromFile(file) {
    // 1. 获取父节点
    const parent = Store.getSelectedNode();
    if (!parent || parent.type !== 'taxon' || isSpeciesNode(parent)) {
        toast('❌ 请先选择一个非物种的分类节点作为导入目标');
        return;
    }

    // 2. 读取 Excel（使用 SheetJS）
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false }); // 空单元格填充 ''

    if (rows.length === 0) {
        toast('❌ Excel 文件为空');
        return;
    }

    // 3. 逐行解析与验证
    const validRows = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            const dataObj = parseExcelRow(row, i + 2); // +2 因为 Excel 行号从1开始，且第一行是表头
            if (dataObj) {
                validRows.push(dataObj);
            }
            // 注意：parseExcelRow 内部如果校验失败会 throw，所以 catch 中处理
        } catch (err) {
            errors.push({ row: i + 2, reason: err.message });
        }
    }

    // 4. 批量创建节点
    if (validRows.length === 0) {
        toast(`⚠️ 无有效行可导入，请检查数据`);
        return;
    }

    // 将所有有效行一次性创建
    for (const dataObj of validRows) {
        try {
            createSpeciesNode(parent, dataObj);
        } catch (err) {
            // 如果单行创建失败（极少见），计入错误并继续
            errors.push({ row: '未知', reason: err.message });
        }
    }

    // 5. 统一保存并刷新
    if (validRows.length > 0) {
        saveData();
        renderTree();
        showTaxonContent(parent);
        selectNode(parent);
    }

    // 6. 反馈
    let msg = `✅ 成功导入 ${validRows.length} 个节点`;
    if (errors.length > 0) {
        const errorSummary = errors.slice(0, 3).map(e => `第${e.row}行: ${e.reason}`).join('；');
        msg += `，跳过 ${errors.length} 行（${errorSummary}${errors.length > 3 ? '…' : ''}）`;
        console.warn('Excel 导入错误详情:', errors);
    }
    toast(msg);
}