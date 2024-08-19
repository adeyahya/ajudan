import Dockerode from "dockerode"

class Docker {
  private client = new Dockerode()

  public async getContainerList() {
    return await this.client.listContainers()
  }
}

export default new Docker()