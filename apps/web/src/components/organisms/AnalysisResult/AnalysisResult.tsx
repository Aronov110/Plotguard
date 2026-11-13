import type { ReactElement, Ref } from "react";
import { describeRunFailure } from "../../../lib/analyses/analysis-feedback.ts";
import {
  countFindings,
  countIdeas,
  describeScope,
  formatRunTime,
} from "../../../lib/analyses/describe-run.ts";
import { describeSize } from "../../../lib/analyses/format-cost.ts";
import type { Analysis, IdeasAnalysis, PlotHoleAnalysis } from "../../../lib/api/analyses-api.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { FindingCard } from "../../molecules/FindingCard/FindingCard.tsx";
import { IdeaCard } from "../../molecules/IdeaCard/IdeaCard.tsx";
import "./AnalysisResult.css";

export interface AnalysisResultProps {
  /** A run that has ended: it succeeded or it failed. */
  readonly analysis: Analysis;
  readonly titles: ReadonlyMap<string, string>;
  /** Attach to the heading: the panel moves the focus there when a writer opens an earlier run. */
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly onClose: () => void;
  /** Called with the id of an item when a link to it is pressed. */
  readonly onOpenItem: (id: string) => void;
}

interface BodyProps<Result> {
  readonly result: NonNullable<Result>;
  readonly titles: ReadonlyMap<string, string>;
  readonly onOpenItem: (id: string) => void;
}

function PlotHolesBody({
  result,
  titles,
  onOpenItem,
}: BodyProps<PlotHoleAnalysis["result"]>): ReactElement {
  return (
    <>
      <p className="analysis-result__summary">{result.summary}</p>
      <p className="analysis-result__facts">
        {describeSize(result.read.characters)} {countFindings(result.findings)}
      </p>
      {result.findings.length === 0 ? (
        <p>
          No plot holes were found. The AI can miss things, so this is not a promise that the story
          is sound.
        </p>
      ) : (
        <>
          <p className="analysis-result__caution">
            The AI can be wrong. Check each finding against your own text.
          </p>
          <ol className="analysis-result__findings" aria-label="Findings">
            {result.findings.map((finding, index) => (
              <FindingCard
                // biome-ignore lint/suspicious/noArrayIndexKey: the findings never change after they are shown, and two may share a title
                key={`${index}-${finding.title}`}
                finding={finding}
                titles={titles}
                onOpenItem={onOpenItem}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function IdeasBody({
  result,
  titles,
  onOpenItem,
}: BodyProps<IdeasAnalysis["result"]>): ReactElement {
  return (
    <>
      <p className="analysis-result__summary">{result.summary}</p>
      <p className="analysis-result__facts">
        {describeSize(result.read.characters)} {countIdeas(result.ideas)}
      </p>
      {result.ideas.length === 0 ? (
        <p>No ideas came up this time. You can try again, perhaps with a focus.</p>
      ) : (
        <>
          <p className="analysis-result__caution">
            These are suggestions, and the AI can be wrong. Use what helps.
          </p>
          <ol className="analysis-result__findings" aria-label="Ideas">
            {result.ideas.map((idea, index) => (
              <IdeaCard
                // biome-ignore lint/suspicious/noArrayIndexKey: the ideas never change after they are shown, and two may share a title
                key={`${index}-${idea.title}`}
                idea={idea}
                titles={titles}
                onOpenItem={onOpenItem}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * What a finished run found or suggested, or why it did not finish. A scan that found nothing says
 * so plainly and reminds the writer that an AI can miss things, as it can be wrong about what it
 * does find. Ideas are called suggestions, because that is what they are. The focus the writer
 * asked for is shown as plain text, as typed (cleaned up), because it is theirs and was kept with
 * the run.
 */
export function AnalysisResult({
  analysis,
  titles,
  headingRef,
  onClose,
  onOpenItem,
}: AnalysisResultProps): ReactElement {
  const when = formatRunTime(analysis.createdAt);
  const scope = describeScope(analysis, titles);
  const heading = `${analysis.kind === "ideas" ? "Ideas for" : "Scan of"} ${scope}${when === undefined ? "" : `, ${when}`}`;
  // A run that ended without a result is told the same way as one that failed.
  const failure = (
    <p className="analysis-result__failure">
      {describeRunFailure(analysis.errorCode, analysis.kind).message}
    </p>
  );

  let body: ReactElement;
  if (analysis.status !== "succeeded") {
    body = failure;
  } else if (analysis.kind === "ideas") {
    body =
      analysis.result === null ? (
        failure
      ) : (
        <IdeasBody result={analysis.result} titles={titles} onOpenItem={onOpenItem} />
      );
  } else {
    body =
      analysis.result === null ? (
        failure
      ) : (
        <PlotHolesBody result={analysis.result} titles={titles} onOpenItem={onOpenItem} />
      );
  }

  return (
    <section className="analysis-result" aria-labelledby="analysis-result-heading">
      <div className="analysis-result__top">
        <h3 id="analysis-result-heading" tabIndex={-1} ref={headingRef}>
          {heading}
        </h3>
        <Button variant="secondary" onClick={onClose}>
          Close this result
        </Button>
      </div>

      {analysis.kind === "ideas" && analysis.focus !== null ? (
        <p className="analysis-result__focus">
          <strong>You asked for ideas about:</strong> {analysis.focus}
        </p>
      ) : null}

      {body}
    </section>
  );
}
