import Dockerode, { type ContainerInfo } from "dockerode"
import db from "./db"

export type ContainerGroup = {
  type: "group",
  name: string,
  data: ContainerInfo[]
} | {
  type: "container",
  data: ContainerInfo
}

class Docker {
  private client = new Dockerode()
  private db = db

  public async getContainerList() {
    return await this.client.listContainers()
  }

  public async getContainerGroupList(): Promise<ContainerGroup[]> {
    const groupMap = new Map<string, ContainerInfo[]>([])
    const plainContainerList: ContainerInfo[] = []
    const containerList = await this.getContainerList()
    containerList.forEach(item => {
      const groupName = item.Labels['com.docker.compose.project']
      if (groupName) {
        if (!groupMap.has(groupName)) groupMap.set(groupName, []);
        groupMap.get(groupName)!.push(item)
      } else {
        plainContainerList.push(item)
      }
    })

    return [
      ...plainContainerList.map(item => ({ type: "container", data: item } as const)),
      ...Array.from(groupMap).map(([groupName, groupList]) => ({ type: "group", name: groupName, data: groupList } as const)),
    ]
  }

  public async getIdByName(name: string) {
    const containerList = await this.getContainerList()
    return containerList.find(item => item.Names[0] === name || item.Names[0] === '/' + name)?.Id ?? ''
  }

  public async redeploy(name: string, cb: (data: any) => void): Promise<any> {
    const id = await this.getIdByName(name)
    return new Promise(async (resolve, reject) => {
      const container = this.getContainerById(id)
      const inspect = await container.inspect()
      const { Config, HostConfig, NetworkSettings } = inspect
      const registryList = await this.db.query.registries.findMany({});
      const registry = registryList.find(item => inspect.Config.Image.includes(item.registryUrl))
      const auth = registry ? {
        username: registry.username,
        password: registry.password,
        serveraddress: registry.registryUrl
      } : {};
      this.client.pull(inspect.Config.Image, {
        'authconfig': auth
      }, (err, stream) => {
        if (err) return reject(err);
        if (!stream) return reject({});
        stream.on("data", data => {
          if (data instanceof Buffer) {
            cb(data.toString())
          } else if (typeof data === "string") {
            cb(data)
          } else {
            cb('' + data)
          }
        })

        this.client.modem.followProgress(stream, async (streamErr, streamOutput) => {
          if (streamErr) return reject(streamErr)
          cb(`{"text": "Stopping Container"}\n`)
          await container.stop();
          cb(`{"text": "Removing Container"}\n`)
          await container.remove();
          cb(`{"text": "Creating Container"}\n`)
          const newContainer = await this.client.createContainer({
            ...Config,
            HostConfig,
            name
          });
          cb(`{"text": "Starting Container"}\n`)
          await newContainer.start();

          const newlyCreatedContainerId = await this.getIdByName(name)
          for (const networkName in NetworkSettings.Networks) {
            if (networkName === "bridge") continue
            const networkConfig = NetworkSettings.Networks[networkName]
            cb(`{"text": "Connecting to network ${networkName}"}\n`)
            if (!networkConfig) continue
            const network = this.client.getNetwork(networkConfig.NetworkID)
            network.connect({
              Container: newlyCreatedContainerId,
              EndpointConfig: networkConfig
            })
          }

          return resolve(streamOutput)
        })
      })
    })
  }

  public getContainerById(id: string) {
    return this.client.getContainer(id)
  }

  public async getContainerInfoById(id: string) {
    const containers = await this.client.listContainers()
    return containers.find(item => item.Id === id)
  }
}

export default new Docker()