import { type ReactElement, useId } from "react";
import type { DocumentDetail } from "../../../lib/api/documents-api.ts";
import { useAddItem } from "../../../lib/documents/use-add-item.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { FormField } from "../../molecules/FormField/FormField.tsx";
import { RadioGroupField } from "../../molecules/RadioGroupField/RadioGroupField.tsx";
import "./AddItemForm.css";

export interface AddItemFormProps {
  readonly projectId: string;
  /**
   * The act or chapter that a scene would go into: the open item if it is one, or the one the open
   * scene is in. Without it, only a top-level item can be added.
   */
  readonly inside: { readonly id: string; readonly title: string } | undefined;
  /** Called with the new document once the API has created it. */
  readonly onAdded: (document: DocumentDetail) => void;
}

/**
 * The form that adds an item to the end of the outline: at the top level (an act or a chapter) or,
 * when one is open, inside it (a scene). The outline allows one level of nesting.
 */
export function AddItemForm({ projectId, inside, onAdded }: AddItemFormProps): ReactElement {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const titleId = `${ids}-title`;
  const form = useAddItem(titleId, { projectId, insideId: inside?.id, onAdded });

  return (
    <section aria-labelledby={headingId} className="add-item">
      <h2 id={headingId} className="add-item__heading">
        Add to the outline
      </h2>
      <form noValidate onSubmit={form.onSubmit}>
        <ErrorSummary items={form.summary} ref={form.summaryRef} />
        <FormField
          id={titleId}
          name="title"
          label="Title"
          hint="The name of the new act, chapter or scene."
          autoComplete="off"
          error={form.titleError}
        />
        {inside === undefined ? (
          <p className="add-item__note">
            It is added at the top level, as an act or a chapter. To add a scene, open an act or a
            chapter first.
          </p>
        ) : (
          // Keyed by the act: when another one is opened, the choice starts again at "inside".
          <RadioGroupField
            key={inside.id}
            id={`${ids}-where`}
            name="where"
            legend="Where to add it"
            options={[
              { value: "inside", label: `Inside “${inside.title}”`, hint: "A scene." },
              { value: "top", label: "At the top level", hint: "An act or a chapter." },
            ]}
            defaultValue="inside"
          />
        )}
        <Button type="submit" busy={form.busy}>
          Add to the outline
        </Button>
      </form>
    </section>
  );
}
