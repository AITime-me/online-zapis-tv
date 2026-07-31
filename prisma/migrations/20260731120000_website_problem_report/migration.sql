-- AlterEnum: website problem reports as booking-request type/source
ALTER TYPE "BookingRequestType" ADD VALUE 'WEBSITE_PROBLEM_REPORT';
ALTER TYPE "BookingRequestSource" ADD VALUE 'WEBSITE_PROBLEM_REPORT';
ALTER TYPE "LegalAcceptanceSource" ADD VALUE 'WEBSITE_PROBLEM_REPORT';
