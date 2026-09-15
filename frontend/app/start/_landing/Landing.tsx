// Лендинг podhod.tech/start — порядок секций по макету «Лендинг v2»
// в проекте Claude Design (правки 1–12, приняты 15.09).

import Business from "./Business";
import Calculator from "./Calculator";
import DeptGets from "./DeptGets";
import Familiar from "./Familiar";
import Footer from "./Footer";
import Header from "./Header";
import Hero from "./Hero";
import HowItLooks from "./HowItLooks";
import Industries from "./Industries";
import { LandingStateProvider } from "./LandingState";
import LeadForm from "./LeadForm";
import MeetTamara from "./MeetTamara";
import NowVsTrainer from "./NowVsTrainer";
import Payback from "./Payback";
import Pricing from "./Pricing";
import RevenueChart from "./RevenueChart";
import Review from "./Review";
import StickyCta from "./StickyCta";
import Summary from "./Summary";

export default function Landing() {
  return (
    <LandingStateProvider>
      <div className="bg-surface text-ink">
        <Header />
        <main>
          <Hero />
          <Familiar />
          <NowVsTrainer />
          <Calculator />
          <MeetTamara />
          <HowItLooks />
          <Review />
          <DeptGets />
          <Industries />
          <Summary />
          <Business />
          <RevenueChart />
          <Pricing />
          <Payback />
          <LeadForm />
        </main>
        <Footer />
        <StickyCta />
      </div>
    </LandingStateProvider>
  );
}
