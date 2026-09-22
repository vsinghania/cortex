/** The slices of Microsoft Graph's OneNote shapes the sync actually reads. */

export type GraphNotebook = {
  id: string;
  display_name: string;
};

export type GraphSection = {
  id: string;
  display_name: string;
  notebook: { id: string; display_name: string } | null;
  /** One level only: the spike found nested groups do not occur in practice. */
  section_group: { id: string; display_name: string } | null;
};

export type GraphPage = {
  id: string;
  title: string;
  created_at?: Date;
  modified_at?: Date;
  /** The page on onenote.com, for "Open in OneNote". */
  web_url?: string;
};

export type GraphPageBatch = {
  pages: GraphPage[];
  /** Opaque; stored in the job checkpoint so a resumed run continues mid-section. */
  next_link?: string;
};

export type ListPagesParams = {
  section_id: string;
  /** Only pages touched after this instant; the sync passes its watermark less an overlap. */
  modified_after?: Date;
  next_link?: string;
  signal?: AbortSignal;
};
