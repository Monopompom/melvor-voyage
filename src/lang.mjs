// Language installation for the 1.3.1 loader.
// The game keeps strings in the global lexical binding `loadedLangJson`, replaced
// wholesale by setLanguage() with the object returned from fetchLanguageJSON().
// We therefore (a) merge into the current object if it already exists and
// (b) wrap fetchLanguageJSON so the object *returned* for any later language
// change already carries our keys.

const SUPPORTED = ['en', 'de', 'fr', 'zh-CN', 'zh-TW'];

export async function install(ctx, { mergeLang, overEnglish }) {
  const read = async (lang) => {
    try {
      return await ctx.loadData(`languages/${lang}.json`);
    } catch (e) {
      console.error('[Voyage] Failed to load language file', lang, e);
      return {};
    }
  };
  // English underneath every translation, so a text added since it was translated never shows as a missing key.
  const load = async (lang) => {
    const en = await read('en');
    return lang !== 'en' && SUPPORTED.includes(lang) ? overEnglish(en, await read(lang)) : en;
  };

  const original = globalThis.fetchLanguageJSON;
  if (typeof original === 'function') {
    globalThis.fetchLanguageJSON = async (lang) => {
      const json = await original(lang);
      return mergeLang(json, await load(lang));
    };
  }

  // eslint-disable-next-line no-undef
  if (typeof loadedLangJson !== 'undefined' && loadedLangJson) {
    // eslint-disable-next-line no-undef
    const current = typeof setLang === 'string' ? setLang : 'en';
    // eslint-disable-next-line no-undef
    mergeLang(loadedLangJson, await load(current));
  }
}
