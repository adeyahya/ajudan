type Props = {
  data: string[];
};

export function ContainerEnv(props: Props) {
  const formattedData = props.data.map((item) => item.split("="));

  return (
    <>
      <h2 className="font-bold px-2 pb-2 pt-4">Environments</h2>
      <table className="table table-xs">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {formattedData.map((item) => (
            <tr key={item[0]}>
              <td>{item[0]}</td>
              <td className="whitespace-break-spaces break-all">{item[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
