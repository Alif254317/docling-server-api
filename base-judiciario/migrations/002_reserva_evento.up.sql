-- Revisão do motor de eventos: cada reserva ganha um token; só quem reservou grava o resultado.
ALTER TABLE evento ADD COLUMN reserva uuid;
