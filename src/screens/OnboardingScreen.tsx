import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors as darkColors, fonts, spacing} from '../design/tokens';

interface OnboardingProps {
  onContinue: () => void;
}

function Onboarding({onContinue}: OnboardingProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(0.84)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(markScale, {
        toValue: 1,
        friction: 8,
        tension: 55,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({finished}) => {
        if (finished) {
          onContinue();
        }
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [markScale, opacity, onContinue]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[styles.page, {opacity}]}>
        <View style={styles.center}>
          <Animated.View style={[styles.logo, {transform: [{scale: markScale}]}]}>
            <View style={styles.logoFrame}>
              <View style={styles.logoCut} />
            </View>
            <View style={styles.logoDot} />
          </Animated.View>
          <Text style={styles.wordmark}>DryWatch</Text>
        </View>

        <Text style={styles.version}>v0.0.6</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: darkColors.background},
  page: {flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xl},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  logo: {width: 62, height: 62, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg},
  logoFrame: {
    width: 46,
    height: 46,
    borderWidth: 1.5,
    borderColor: darkColors.text,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{rotate: '45deg'}],
  },
  logoCut: {width: 22, height: 22, borderWidth: 1.5, borderColor: darkColors.text},
  logoDot: {position: 'absolute', width: 8, height: 8, backgroundColor: darkColors.text},
  wordmark: {fontFamily: fonts.light, fontSize: 28, letterSpacing: -0.8, color: darkColors.text},
  version: {fontFamily: fonts.light, fontSize: 11, letterSpacing: 0.6, color: darkColors.textSecondary},
});

export default Onboarding;
