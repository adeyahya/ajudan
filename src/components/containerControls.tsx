export function ContainerControls() {
  return (
    <div className="flex flex-row items-center gap-2 pb-2 justify-end">
      <button disabled className="btn btn-xs btn-neutral">
        {/* <span className="loading loading-spinner loading-xs"></span> */}
        Start
      </button>
      <button className="btn btn-xs btn-error">Stop</button>
      <button className="btn btn-xs btn-neutral">Restart</button>
      <button className="btn btn-xs btn-neutral">Redeploy</button>
    </div>
  );
}
