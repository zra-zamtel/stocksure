import { Redirect } from 'expo-router';

/**
 * The centre Sell button in the tab bar opens the sale screen directly (see
 * the custom tabBarButton in the tabs layout). Expo Router 58 needs the route
 * declared, so this only catches a stray deep link. It goes Home rather than
 * to the sale: a redirect into the stack would loop Back, and Home shows Sell
 * only to people who may record a sale.
 */
export default function SellTab() {
  return <Redirect href="/" />;
}
