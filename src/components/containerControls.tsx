import { useRef } from "react";
import { RedeployModal, type ImperativeAPI } from "./RedeployModal";

type Props = {
  name: string;
};

export function ContainerControls(props: Props) {
  const modalRef = useRef<ImperativeAPI>(null);

  const onRedeploy = () => {
    if (!modalRef.current) return;
    modalRef.current.start();
  };

  return (
    <>
      <RedeployModal ref={modalRef} name={props.name} />
      <div className="flex flex-row items-center pb-2 justify-between">
        <div className="flex flex-row gap-1 items-center">
          <div className="badge badge-success text-xs">Running</div>
        </div>
        <div className="flex flex-row gap-1">
          <button disabled className="btn btn-xs btn-neutral">
            {/* <span className="loading loading-spinner loading-xs"></span> */}
            Start
          </button>
          <button className="btn btn-xs btn-error">Stop</button>
          <button className="btn btn-xs btn-neutral">Restart</button>
          <button onClick={onRedeploy} className="btn btn-xs btn-neutral">
            Redeploy
          </button>
        </div>
      </div>
    </>
  );
}
