// 字數統計：中文、日文、韓文以字計，英文與數字以單字計（狀態列與「字數統計」視窗共用同一套算法）
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;

export function countText(text) {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.replace(CJK, ' ').match(/[A-Za-z0-9]+(?:['’.\-][A-Za-z0-9]+)*/g) || []).length;
  return { cjk, latin, words: cjk + latin, chars: text.replace(/\s/g, '').length, charsWithSpaces: text.replace(/\n/g, '').length };
}
