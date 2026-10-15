// Language installation for the 1.3.1 loader.
// The game keeps strings in the global lexical binding `loadedLangJson`, replaced
// wholesale by setLanguage() with the object returned from fetchLanguageJSON().
// We therefore (a) merge into the current object if it already exists and
// (b) wrap fetchLanguageJSON so the object *returned* for any later language
// change already carries our keys.

const SUPPORTED = ['en'];

export async function install(ctx, { mergeLang }) {
  const pick = (lang) => (SUPPORTED.includes(lang) ? lang : 'en');
  const load = async (lang) => {
    try {
      return await ctx.loadData(`languages/${pick(lang)}.json`);
    } catch (e) {
      console.error('[Voyage] Failed to load language file', lang, e);
      return {};
    }
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
