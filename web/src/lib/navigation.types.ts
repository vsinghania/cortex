/** Router state a page can pass so the destination renders a "back" link to where the user came from. */
export type ReturnLinkState = {
  return_to: string;
  return_label: string;
};
