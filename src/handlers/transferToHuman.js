class TransferToHuman {
  constructor(chatHandler) {
    this.chatHandler = chatHandler;
  }

  async handleTransfer(reason) {
    // Logica per trasferire la chat a un operatore umano
    console.log(`Transferring chat to human operator for reason: ${reason}`);
  }
}
