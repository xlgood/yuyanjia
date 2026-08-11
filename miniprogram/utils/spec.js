// 把 AI 起草的「草稿」规范化为可入库的 resolutionSpec
// draft 形态与 aiDraftSpec 返回一致：
//   { mode:'numeric'|'manual', provider, field, transform, operator, value, unit, humanReadable }
function buildResolutionSpec(draft, sources) {
  if (!draft || !draft.mode) return null;
  if (draft.mode === 'manual') {
    return {
      version: 1,
      dataSource: { type: 'manual', provider: draft.provider || '官方公告' },
      evidence: { saveRawResponse: false, saveScreenshot: true },
      humanReadable: draft.humanReadable || ''
    };
  }
  const src = (sources || []).find(s => s.name === draft.provider);
  return {
    version: 1,
    dataSource: {
      type: 'api',
      provider: draft.provider || '',
      url: src ? src.url : '',
      field: draft.field || '',
      transform: draft.transform || 'int'
    },
    condition: {
      operator: draft.operator,
      value: draft.value,
      unit: draft.unit || ''
    },
    binaryRule: { missingData: 'refund', tie: 'NO' },
    evidence: { saveRawResponse: true, saveScreenshot: false },
    humanReadable: draft.humanReadable || ''
  };
}

module.exports = { buildResolutionSpec };
