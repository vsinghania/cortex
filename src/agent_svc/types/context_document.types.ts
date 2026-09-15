/** A document attached to a conversation, loaded fresh for the run that uses it. */
export type ContextDocument = {
  corpus: string;
  document_id: string;
  title: string;
  body: string;
};
