import Dockerode from "dockerode"

class Docker {
  private client = new Dockerode()

  public async getContainerList() {
    return await this.client.listContainers()
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