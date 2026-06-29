// Корневая страница. Авторизованных пользователей сразу отправляем
// на главный экран /session (неавторизованных перехватит middleware).
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/session");
}
