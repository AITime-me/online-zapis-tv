-- Добавление статуса «Перенесена» для записей после переноса визита.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'RESCHEDULED';
