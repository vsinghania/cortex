import { Component } from 'react';
import { ApiClient } from '../../lib/api_client';
import { NoteTagOptions } from '../../lib/note_tag_options';
import { Icon } from '../icon';

type Props = {
  selected_tags: string[];
  input_label: string;
  onAddTag: (tag: string) => void;
};

type State = {
  tags: string[];
  value: string;
  loading: boolean;
  failed: boolean;
};

export class NoteTagPicker extends Component<Props, State> {
  state: State = { tags: [], value: '', loading: true, failed: false };
  private mounted = false;

  componentDidMount(): void {
    this.mounted = true;
    void this.loadExistingTags();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  private async loadExistingTags(): Promise<void> {
    this.setState({ loading: true, failed: false });
    try {
      const response = await ApiClient.listNoteTags();
      if (this.mounted) this.setState({ tags: response.tags.map(({ tag }) => tag), loading: false });
    } catch {
      if (this.mounted) this.setState({ failed: true, loading: false });
    }
  }

  private addTag(tag: string): void {
    if (NoteTagOptions.canAddTag({ selected: this.props.selected_tags, value: tag })) {
      this.props.onAddTag(tag);
    }
  }

  render() {
    const { tags, value, loading, failed } = this.state;
    const { selected_tags } = this.props;
    const available_tags = NoteTagOptions.filterAvailableTags(tags, selected_tags, value);
    const tag_to_add = NoteTagOptions.resolveTagToAdd(tags, value);
    const can_add = NoteTagOptions.canAddTag({ selected: selected_tags, value });

    return (
      <>
        <form
          className="tag-picker-form"
          onSubmit={(event) => {
            event.preventDefault();
            this.addTag(tag_to_add);
          }}
        >
          <input
            className="input tag-picker-input"
            value={value}
            autoFocus
            placeholder="Find or create a tag…"
            aria-label={this.props.input_label}
            onChange={(event) => this.setState({ value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === ',') {
                event.preventDefault();
                this.addTag(tag_to_add);
              }
            }}
          />
          <button type="submit" className="icon-btn" disabled={!can_add} aria-label="Add tag" title="Add tag">
            <Icon name="plus" size={14} />
          </button>
        </form>
        <div className="menu-heading">Existing tags</div>
        {loading && <div className="menu-note" role="status">Loading tags…</div>}
        {failed && (
          <div className="menu-note" role="status">
            Couldn't load tags.
            <button type="button" className="menu-item" onClick={() => void this.loadExistingTags()}>Try again</button>
          </div>
        )}
        {!loading && !failed && available_tags.length === 0 && (
          <div className="menu-note">{value ? 'No available matching tags.' : 'No other tags yet.'}</div>
        )}
        <div className="picker-scroll">
          {available_tags.map((tag) => (
            <button key={tag} type="button" role="menuitem" className="menu-item" onClick={() => this.addTag(tag)}>
              <Icon name="hash" size={13} />
              <span className="menu-item-label">{tag}</span>
            </button>
          ))}
        </div>
      </>
    );
  }
}
