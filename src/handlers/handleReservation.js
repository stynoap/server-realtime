const { base_api } = require("../config/constants");
const nodemailer = require("nodemailer");

class HandleReservation {
  constructor(openaiWs, response, hotelId, twilioCallId) {
    this.openaiWs = openaiWs;
    this.response = response;
    this.hotelId = hotelId;
    this.twilioCallId = twilioCallId;
  }

  async _handleReservationFunctionCall() {
    console.log("📋 Gestione prenotazione avviata");

    // ✅ 1. Parse e validazione argomenti
    const args = this._parseReservationArgs(this.response.arguments);
    if (!args) {
      return this._sendErrorResponse(
        "Non sono riuscito a leggere i dettagli della prenotazione. Puoi ripetere?"
      );
    }

    const {
      reservation_type,
      date,
      time,
      customer_name,
      customer_surname,
      customer_email,
      notes,
    } = args;

    if (!this._validateReservationData(args)) {
      return this._sendErrorResponse(
        "Mancano alcuni dettagli essenziali (tipo, data, ora, nome, cognome, email)."
      );
    }

    const prenotazione = {
      reservation_type,
      date,
      time,
      customer_name,
      customer_surname,
      customer_email,
      notes: notes || null,
      hotel_id: this.hotelId,
      callId: this.twilioCallId,
    };

    console.log("📤 Invio prenotazione al backend:", prenotazione);

    try {
      const reservationInsert = await fetch(`${base_api}prenotazione`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prenotazione),
      });

      if (!reservationInsert.ok) {
        throw new Error(`HTTP error! status: ${reservationInsert.status}`);
      }

      const confirmationMessage = this._buildConfirmationMessage(prenotazione);

      await this._sendReservationConfirmation(
        confirmationMessage,
        customer_email
      );

      return this._sendSuccessResponse(
        prenotazione,
        "Prenotazione confermata! È stata inviata un'email di conferma."
      );
    } catch (error) {
      console.error("❌ Errore salvataggio prenotazione:", error);
      return this._sendErrorResponse(
        "C'è stato un problema con la prenotazione. Può riprovare o contattare la reception."
      );
    }
  }

  _parseReservationArgs(argumentsString) {
    try {
      return JSON.parse(argumentsString);
    } catch (err) {
      console.error("❌ Errore parsing argomenti prenotazione:", err);
      return null;
    }
  }

  _validateReservationData(args) {
    const {
      reservation_type,
      date,
      time,
      customer_name,
      customer_surname,
      customer_email,
    } = args;
    return (
      reservation_type &&
      date &&
      time &&
      customer_name &&
      customer_surname &&
      customer_email
    );
  }

  _buildConfirmationMessage(prenotazione) {
    return `La tua prenotazione è stata registrata con successo! 🎉

Dettagli:
- Tipo: ${prenotazione.reservation_type}
- Data: ${prenotazione.date}
- Ora: ${prenotazione.time}
- Nome: ${prenotazione.customer_name} ${prenotazione.customer_surname}
- Email: ${prenotazione.customer_email}
${prenotazione.notes ? `- Note: ${prenotazione.notes}` : ""}

Se noti errori, contattaci. Grazie per aver scelto Moka!`;
  }

  _sendErrorResponse(errorMessage) {
    this.openaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: this.response.call_id,
          output: JSON.stringify({ success: false, error: errorMessage }),
        },
      })
    );

    this.openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: errorMessage,
        },
      })
    );
  }

  _sendSuccessResponse(prenotazione, successMessage) {
    this.openaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: this.response.call_id,
          output: JSON.stringify({ success: true, reservation: prenotazione }),
        },
      })
    );

    this.openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: `Comunica al cliente: "${successMessage} La prenotazione per ${prenotazione.reservation_type} è confermata per il ${prenotazione.date} alle ${prenotazione.time}. "`,
        },
      })
    );
  }

  async _sendReservationConfirmation(confirmationMessage, customer_email) {
    console.log("dentro la funzione di invio della email");
    const transport = nodemailer.createTransport({
      host: "sandbox.smtp.mailtrap.io",
      port: 2525,
      auth: {
        user: "c117cad204c8a5",
        pass: "daff97052b9ac3",
      },
    });

    const response = await transport.sendMail({
      from: '"Moka Assistant"',
      to: customer_email,
      subject: "Conferma Prenotazione",
      text: `${confirmationMessage}`,
    });

    console.log("📧 Email di conferma inviata:", response);
    return response;
  }
}

module.exports = HandleReservation;
