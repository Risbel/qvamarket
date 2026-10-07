// Schemas are built by factories that receive a translator, so error messages
// follow the user's locale. Works with both `useTranslations` (client) and
// `getTranslations` (server) scoped to the "Validation" namespace.
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;
