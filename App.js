import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  Platform,
  StatusBar,
  Vibration,
  LayoutAnimation,
  UIManager
} from 'react-native';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
// For PC/emulator testing, use localhost. For phone testing, use your laptop's LAN IP (e.g. http://192.168.x.x:8000).
const API_BASE_URL = 'https://hostelmealping.vercel.app';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [userName, setUserName] = useState('');
  const [isNameSet, setIsNameSet] = useState(false);
  const [inputName, setInputName] = useState('');
  const [expoPushToken, setExpoPushToken] = useState('');
  const [currentMeal, setCurrentMeal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notificationModalVisible, setNotificationModalVisible] = useState(false);
  const [receivedData, setReceivedData] = useState(null);
  const ringInterval = useRef(null);
  const lastMealJson = useRef('');

  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    checkName();
    registerForPushNotificationsAsync().then(token => {
      if (token) setExpoPushToken(token);
    });

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      setReceivedData(notification.request.content.data);
      setNotificationModalVisible(true); // Always show modal if app is open
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const { actionIdentifier, notification } = response;
      const data = notification.request.content.data;

      if (actionIdentifier === 'JOIN') {
        handleRSVP('join', data.creator_name);
      } else if (actionIdentifier === 'SKIP') {
        handleRSVP('not_coming', data.creator_name);
      } else {
        setReceivedData(data);
        setNotificationModalVisible(true);
      }
    });

    fetchCurrentMeal();
    const interval = setInterval(() => {
      fetchCurrentMeal();
    }, 5000);

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current);
      clearInterval(interval);
    };
  }, []);

  const updateMealState = (data) => {
    const json = JSON.stringify(data);
    if (json === lastMealJson.current) return; // No change, skip re-render
    lastMealJson.current = json;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCurrentMeal(data);
  };

  useEffect(() => {
    if (isNameSet) {
      registerUserOnBackend();
    }
  }, [isNameSet, expoPushToken]);

  const checkName = async () => {
    const savedName = await AsyncStorage.getItem('userName');
    if (savedName) {
      setUserName(savedName);
      setIsNameSet(true);
    }
  };

  const handleSaveName = async () => {
    if (inputName.trim().length < 2) {
      Alert.alert('Error', 'Please enter a valid name');
      return;
    }
    await AsyncStorage.setItem('userName', inputName.trim());
    setUserName(inputName.trim());
    setIsNameSet(true);
  };

  const registerUserOnBackend = async () => {
    try {
      const resp = await fetch(`${API_BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: userName,
          push_token: expoPushToken || `web-${Math.random().toString(36).substring(2, 9)}`
        })
      });
      if (!resp.ok) throw new Error('Registration failed');
    } catch (error) {
      console.warn('Registration failed:', error.message);
    }
  };

  const fetchCurrentMeal = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/meal/current`);
      if (!response.ok) {
        // Non-200 responses should not crash but clear the meal
        setCurrentMeal(null);
        return;
      }

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        if (data.status !== 'no_active_meal') {
          updateMealState(data);
        } else {
          updateMealState(null);
        }
      } else {
        updateMealState(null);
      }
    } catch (error) {
      console.warn('Fetch meal failed:', error.message);
      updateMealState(null);
    }
  };

  const sendMealRequest = async (type) => {
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_type: type,
          creator_name: userName
        })
      });
      if (!resp.ok) {
        throw new Error('Server returned an error');
      }
      lastMealJson.current = ''; // Force refresh on next poll
      fetchCurrentMeal();
    } catch (error) {
      Alert.alert('Connection Error', 'Could not reach the server. Please check your internet or if the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const triggerMeal = (type) => {
    if (currentMeal && currentMeal.active) {
      Alert.alert(
        'Replace Meal?',
        `There's already an active ${currentMeal.meal_type}. Start ${type} instead?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, Replace', onPress: () => sendMealRequest(type) }
        ]
      );
    } else {
      sendMealRequest(type);
    }
  };

  const handleRSVP = async (status) => {
    try {
      let activeName = userName;
      if (!activeName) {
        activeName = await AsyncStorage.getItem('userName');
      }
      if (!activeName) {
        Alert.alert('Error', 'Please set your name first');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/meal/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activeName,
          status: status
        })
      });

      if (response.ok) {
        setNotificationModalVisible(false);
        fetchCurrentMeal();
      } else {
        Alert.alert('Error', 'Could not update your status');
      }
    } catch (error) {
      Alert.alert('Connection Error', 'Failed to update RSVP');
      console.error('RSVP failed', error);
    }
  };

  useEffect(() => {
    if (notificationModalVisible) {
      if (Platform.OS !== 'web') {
        const pattern = [500, 500, 1000, 500, 1000, 500];
        Vibration.vibrate(pattern, true);
      }
    } else {
      Vibration.cancel();
    }
    return () => Vibration.cancel();
  }, [notificationModalVisible]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const UserAvatar = ({ name, color }) => (
    <View style={[styles.avatarFixed, { backgroundColor: color }]}>
      <Text style={styles.avatarTextFixed}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );


  async function registerForPushNotificationsAsync() {
    if (Platform.OS === 'web') return null;
    let token;
    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          android: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowAnnouncements: true,
          },
        });
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        console.log('Push notification permission not granted');
        return null;
      }

      try {
        token = (await Notifications.getExpoPushTokenAsync({
          projectId: Constants.expoConfig?.extra?.eas?.projectId,
        })).data;
        console.log('Push token:', token);
      } catch (e) {
        console.log("Push token error", e);
      }
    } else {
      console.log('Must use physical device for push notifications');
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('meal-pings', {
        name: 'Meal Pings',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000],
        lightColor: '#FF6EEF',
        lockscreenVisibility: Notifications.AndroidLockscreenVisibility.PUBLIC,
        bypassDnd: true,
        enableVibration: true,
        enableLights: true,
        showBadge: true,
        sound: 'default',
      });
    }

    // Set up notification categories (Join/Skip buttons)
    await Notifications.setNotificationCategoryAsync('MEAL_INVITATION', [
      {
        identifier: 'JOIN',
        buttonTitle: 'Count me in! ✅',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'SKIP',
        buttonTitle: 'Can\'t make it ❌',
        options: { opensAppToForeground: false },
      },
    ]);

    return token;
  }

  const getTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  if (!isNameSet) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.container}>
          <View style={styles.onboardingCard}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoEmoji}>🍛</Text>
            </View>
            <Text style={styles.titleText}>Hostel Meal</Text>
            <Text style={styles.subtitleText}>Join your friends for meals effortlessly. Enter your name to begin.</Text>

            <TextInput
              style={styles.inputField}
              placeholder="Your Full Name"
              placeholderTextColor="#ADB5BD"
              value={inputName}
              onChangeText={setInputName}
            />

            <TouchableOpacity
              style={[styles.primaryButton, (!inputName || inputName.trim().length < 2) && styles.disabled]}
              onPress={handleSaveName}
              disabled={!inputName || inputName.trim().length < 2}
            >
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>

        {/* Header Section */}
        <View style={styles.topHeader}>
          <View>
            <Text style={styles.statusSub}>{getGreeting()},</Text>
            <Text style={styles.welcomeText}>{userName.split(' ')[0]}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={styles.refreshCircle} onPress={() => { setLoading(true); fetchCurrentMeal().finally(() => setLoading(false)); }}>
              <Text style={{ fontSize: 20 }}>🔄</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileCircle} onPress={async () => { await AsyncStorage.clear(); setIsNameSet(false); }}>
              <Text style={styles.profileText}>{userName ? userName.charAt(0).toUpperCase() : 'U'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Grid */}
        <Text style={styles.sectionHeader}>Quick Ping</Text>
        <View style={styles.actionGrid}>
          {[
            { label: 'Breakfast', emoji: '☕', color: '#FFF4E6' },
            { label: 'Lunch', emoji: '🍱', color: '#EBFBEE' },
            { label: 'Dinner', emoji: '🥘', color: '#FFF5F5' }
          ].map((item, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.actionCard, loading && styles.disabled]}
              onPress={() => triggerMeal(item.label)}
              disabled={loading}
            >
              <View style={[styles.emojiBg, { backgroundColor: item.color }]}>
                <Text style={styles.cardEmoji}>{item.emoji}</Text>
              </View>
              <Text style={styles.cardLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Active Meal Section */}
        <Text style={styles.sectionHeader}>Live Activity</Text>
        {currentMeal ? (
          <View style={styles.liveCard}>
            <View style={styles.liveTag}>
              <View style={styles.pulse} />
              <Text style={styles.tagText}>HAPPENING NOW</Text>
            </View>

            <View style={styles.liveContent}>
              <Text style={styles.liveMealTitle}>{currentMeal.meal_type} Time</Text>
              <Text style={styles.liveTime}>Started by {currentMeal.creator_name}</Text>
            </View>

            <View style={styles.rsvpStack}>
              <TouchableOpacity
                style={[styles.rsvpBtn, styles.btnIn, currentMeal.joining.includes(userName) && styles.activeIn]}
                onPress={() => handleRSVP('join')}
              >
                <Text style={[styles.rsvpBtnText, { color: currentMeal.joining.includes(userName) ? 'white' : '#51CF66' }]}>
                  {currentMeal.joining.includes(userName) ? "You're In!" : "Count me in!"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rsvpBtn, styles.btnOut, currentMeal.not_coming.includes(userName) && styles.activeOut]}
                onPress={() => handleRSVP('not_coming')}
              >
                <Text style={[styles.rsvpBtnText, { color: currentMeal.not_coming.includes(userName) ? 'white' : '#FF6B6B' }]}>
                  {currentMeal.not_coming.includes(userName) ? "Not Coming" : "Can't make it"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.guestList}>
              <View>
                <Text style={styles.guestTitle}>Joining ({currentMeal.joining.length})</Text>
                <View style={styles.avatarRow}>
                  {currentMeal.joining.length > 0 ? (
                    currentMeal.joining.map((name, i) => (
                      <View key={i} style={styles.avatarWithName}>
                        <UserAvatar name={name} color="#51CF66" />
                        <Text style={styles.avatarNameText}>{name}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.emptyGuest, { color: '#909296' }]}>Waiting for souls...</Text>
                  )}
                </View>
              </View>

              <View>
                <Text style={styles.guestTitle}>Declined ({currentMeal.not_coming.length})</Text>
                <View style={styles.avatarRow}>
                  {currentMeal.not_coming.length > 0 ? (
                    currentMeal.not_coming.map((name, i) => (
                      <View key={i} style={styles.avatarWithName}>
                        <UserAvatar name={name} color="#FF6B6B" />
                        <Text style={styles.avatarNameText}>{name}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.emptyGuest, { color: '#909296' }]}>Nobody yet...</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.emptyStateContainer}>
            <Text style={styles.emptyIcon}>😴</Text>
            <Text style={styles.emptyTitle}>Nothing active</Text>
            <Text style={styles.emptyText}>Be the first to ping your friends for the next meal!</Text>
          </View>
        )}
      </ScrollView>

      {/* Notification Modal */}
      <Modal animationType="fade" transparent={true} visible={notificationModalVisible}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.mEmoji}>🔔</Text>
            <Text style={styles.mTitle}>Meal Invite!</Text>
            <Text style={styles.mBody}>{receivedData?.creator_name} is calling for {receivedData?.meal_type}</Text>
            <View style={styles.mButtons}>
              <TouchableOpacity style={[styles.mBtn, { backgroundColor: '#51CF66' }]} onPress={() => handleRSVP('join')}>
                <Text style={styles.mBtnText}>Join Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.mBtn, { backgroundColor: '#FF6B6B', marginTop: 10 }]} onPress={() => handleRSVP('not_coming')}>
                <Text style={styles.mBtnText}>Maybe next time</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8F9FA' },
  container: { flex: 1, backgroundColor: '#F8F9FA', justifyContent: 'center', padding: 25 },
  scrollContainer: { padding: 20 },

  // Onboarding
  onboardingCard: {
    backgroundColor: 'white',
    borderRadius: 35,
    padding: 35,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
      android: { elevation: 12 }
    })
  },
  logoBadge: { width: 90, height: 90, borderRadius: 30, backgroundColor: '#FFF5F5', justifyContent: 'center', alignItems: 'center', marginBottom: 25 },
  logoEmoji: { fontSize: 45 },
  titleText: { fontSize: 28, fontWeight: '900', color: '#1A1B1E', marginBottom: 12 },
  subtitleText: { fontSize: 17, color: '#909296', textAlign: 'center', marginBottom: 35, lineHeight: 24 },
  inputField: {
    width: '100%',
    backgroundColor: '#F1F3F5',
    height: 65,
    borderRadius: 20,
    paddingHorizontal: 20,
    fontSize: 18,
    color: '#1A1B1E',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E9ECEF'
  },

  // Buttons
  primaryButton: {
    width: '100%',
    backgroundColor: '#FF6B6B',
    height: 65,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.4, shadowRadius: 10 },
      android: { elevation: 8 }
    })
  },
  primaryButtonText: { color: 'white', fontSize: 20, fontWeight: '800' },

  // Dashboard Header
  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 35, marginTop: 15 },
  welcomeText: { fontSize: 32, fontWeight: '900', color: '#1A1B1E' },
  statusSub: { fontSize: 17, color: '#909296', marginTop: 5 },
  profileCircle: { width: 55, height: 55, borderRadius: 27.5, backgroundColor: '#FF6B6B', justifyContent: 'center', alignItems: 'center' },
  refreshCircle: { width: 55, height: 55, borderRadius: 27.5, backgroundColor: '#EDF2F7', justifyContent: 'center', alignItems: 'center' },
  profileText: { color: 'white', fontWeight: '900', fontSize: 22 },

  // Grids
  sectionHeader: { fontSize: 14, fontWeight: '900', color: '#ADB5BD', marginBottom: 20, letterSpacing: 2, textTransform: 'uppercase' },
  actionGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 40, gap: 15 },
  actionCard: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 25,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1F3F5',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 },
      android: { elevation: 4 }
    })
  },
  emojiBg: { width: 55, height: 55, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  cardEmoji: { fontSize: 26 },
  cardLabel: { fontSize: 15, fontWeight: '800', color: '#495057' },

  // Live Card (Modern Black)
  liveCard: {
    backgroundColor: '#1A1B1E',
    borderRadius: 35,
    padding: 30,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 15 }, shadowOpacity: 0.3, shadowRadius: 25 },
      android: { elevation: 20 }
    })
  },
  liveTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2C2E33', alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, marginBottom: 20 },
  pulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#51CF66', marginRight: 10 },
  tagText: { color: '#51CF66', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  liveContent: { marginBottom: 30 },
  liveMealTitle: { color: 'white', fontSize: 30, fontWeight: '900' },
  liveTime: { color: '#909296', marginTop: 8, fontSize: 16 },

  // RSVP Buttons
  rsvpStack: { flexDirection: 'row', gap: 12, marginBottom: 35 },
  rsvpBtn: { flex: 1, height: 60, borderRadius: 18, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  btnIn: { borderColor: '#51CF6640', backgroundColor: '#51CF6615' },
  btnOut: { borderColor: '#FF6B6B40', backgroundColor: '#FF6B6B15' },
  activeIn: { backgroundColor: '#51CF66', borderColor: '#51CF66' },
  activeOut: { backgroundColor: '#FF6B6B', borderColor: '#FF6B6B' },
  rsvpBtnText: { fontWeight: '800', fontSize: 17 },

  // Members List
  guestList: { gap: 25 },
  guestTitle: { color: 'white', fontSize: 15, fontWeight: '700', marginBottom: 15, opacity: 0.7 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  avatarFixed: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  avatarTextFixed: { color: 'white', fontWeight: '900', fontSize: 16 },
  avatarWithName: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  avatarNameText: { color: '#CED4DA', fontSize: 14, fontWeight: '600' },

  // Modal (Glassmorphism inspired)
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 25 },
  modal: {
    backgroundColor: 'white',
    borderRadius: 35,
    padding: 40,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30 },
      android: { elevation: 25 }
    })
  },
  mEmoji: { fontSize: 50, marginBottom: 20 },
  mTitle: { fontSize: 26, fontWeight: '900', marginBottom: 12, color: '#1A1B1E' },
  mBody: { color: '#909296', textAlign: 'center', fontSize: 18, marginBottom: 35, lineHeight: 26 },
  mButtons: { flexDirection: 'column', width: '100%', gap: 12 },
  mBtn: { width: '100%', height: 65, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  mBtnText: { color: 'white', fontWeight: '800', fontSize: 18 },

  // Others
  emptyStateContainer: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 70, marginBottom: 20 },
  emptyTitle: { fontSize: 24, fontWeight: '900', color: '#CED4DA' },
  emptyText: { color: '#DEE2E6', textAlign: 'center', marginTop: 10, fontSize: 16, lineHeight: 22 },
  disabled: { opacity: 0.6 }
});
