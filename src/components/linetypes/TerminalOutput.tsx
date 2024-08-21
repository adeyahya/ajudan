import React, { Fragment } from "react";
import Ansi from "ansi-to-react";

const TerminalOutput = ({ children }: { children?: string }) => {
  return (
    <div className="react-terminal-line">
      {Array.isArray(children) ? (
        children.map((child, idx) => (
          <Fragment key={idx}>
            <Ansi>{child}</Ansi>
          </Fragment>
        ))
      ) : (
        <Ansi>{children ?? ""}</Ansi>
      )}
    </div>
  );
};

export default TerminalOutput;
